const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Session = require('../models/sessionModel');
const FileAsset = require('../models/fileAssetModel');
const NachsorgeCheck = require('../models/nachsorgeCheckModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { computeHealingAssessment, applyStudioHealingCorrection, worseAmpel } = require('../utils/healingLogicEngine');
const { evaluateAndApplySessionLightening } = require('../utils/lighteningSessionService');
const { assertCaseAccess, assertCaseWriteAccess, isCustomer, isStudio, isAdmin, refId } = require('../utils/accessHelpers');
const { assertFileAccess, logFileAccess } = require('../services/fileAccessService');
const { readFileBuffer } = require('../services/fileStorageService');
const { FILE_AUDIT_ACTION, FILE_STATUS } = require('../config/storageConfig');
const { ELAYA_NACHSORGE_SYSTEM } = require('../content/aiPrompts');
const {
    callClaude,
    imageContentFromBuffer,
    isAiEnabled,
} = require('../services/anthropicService');
const { getAiSystemPrompt } = require('../utils/aiConfigService');
const { assertAiFeatureAllowed } = require('../utils/aiFeatureGate');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { normalizePreferredLang } = require('../utils/preferredLanguage');

const normalizeAmpel = (value) => {
    const raw = String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    if (raw.includes('rot') || raw === 'red') return 'rot';
    if (raw.includes('gruen') || raw.includes('grun') || raw === 'green') return 'gruen';
    if (raw.includes('orange')) return 'orange';
    return 'orange';
};

const daysSince = (dateValue) => {
    if (!dateValue) return null;
    const then = new Date(dateValue);
    if (Number.isNaN(then.getTime())) return null;
    const ms = Date.now() - then.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

const resolveTageNachSitzung = (sitzungsDatum, caseDoc) => {
    if (sitzungsDatum) return daysSince(sitzungsDatum);
    if (caseDoc.lastSessionDate) return daysSince(caseDoc.lastSessionDate);
    return null;
};

const loadOwnedCase = async (user, caseId) => {
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    await assertCaseAccess(user, caseDoc);
    return caseDoc;
};

/**
 * Resolve which zone an aftercare check documents.
 *
 * Zone cases must name a zone: each zone heals on its own timeline and is
 * photographed separately, so an unassigned check could not be compared with
 * the zone's own history. Single-tattoo cases must not name one.
 */
const resolveCheckZone = async (caseDoc, zonenId) => {
    const requested = typeof zonenId === 'string' ? zonenId.trim() : null;

    if (!caseDoc.zonen_aktiv) {
        if (requested) {
            throw new ApiError(400, 'zonen_id is only valid for cases split into zones');
        }
        return null;
    }

    if (!requested) {
        throw new ApiError(
            400,
            'zonen_id is required for a zone case — aftercare is documented per zone'
        );
    }

    const zone = await CaseZone.findOne({ case: caseDoc._id, zonen_id: requested })
        .select('_id')
        .lean();

    if (!zone) {
        throw new ApiError(400, `zonen_id "${requested}" does not belong to this case`);
    }

    return requested;
};

const loadPhotoForAi = async (user, fotoFileId, caseDoc, req) => {
    const fileAsset = await FileAsset.findById(fotoFileId);
    if (!fileAsset || fileAsset.status === FILE_STATUS.DELETED) {
        throw new ApiError(404, 'Photo file not found');
    }
    await assertFileAccess(user, fileAsset);

    if (
        fileAsset.customer &&
        refId(fileAsset.customer) !== refId(caseDoc.customer)
    ) {
        throw new ApiError(403, 'Photo does not belong to this case customer');
    }

    const buffer = await readFileBuffer(fileAsset.storage_path);
    await logFileAccess(fileAsset._id, user, FILE_AUDIT_ACTION.AI_ANALYZE, req, {
        case_id: String(caseDoc._id),
    });

    return { fileAsset, buffer, mimeType: fileAsset.mime_type || 'image/jpeg' };
};

const mapPhotoOnlyResult = (parsed) => {
    const analyse = parsed?.analyse || {};
    const status = normalizeAmpel(analyse.status || parsed?.foto_status || parsed?.status);
    const befund =
        analyse.grund ||
        analyse.bewertung ||
        parsed?.foto_befund ||
        parsed?.foto_beschreibung ||
        '';
    const auffaelligkeiten = Array.isArray(analyse.warnsignale)
        ? analyse.warnsignale
        : Array.isArray(parsed?.foto_auffaelligkeiten)
          ? parsed.foto_auffaelligkeiten
          : [];

    return {
        foto_status: status,
        foto_befund: befund,
        foto_beschreibung: befund,
        foto_auffaelligkeiten: auffaelligkeiten.map(String),
        nachfrage:
            analyse.empfehlung ||
            parsed?.nachfrage ||
            'Hast du Schmerzen oder Beschwerden an der behandelten Stelle?',
        wichtiger_hinweis:
            analyse.hinweis ||
            analyse.wichtiger_hinweis ||
            'Diese Analyse ersetzt keine medizinische Beurteilung. Bei Unsicherheit immer das Studio kontaktieren.',
        bewertung: analyse.bewertung || '',
        empfehlung: analyse.empfehlung || '',
    };
};

const mapCombinedResult = (parsed, photoStage) => {
    const analyse = parsed?.analyse || {};
    let status = normalizeAmpel(
        analyse.status || parsed?.status || photoStage?.foto_status || 'orange'
    );

    // Photo always wins — never improve ampel vs photo stage
    if (photoStage?.foto_status) {
        const rank = { gruen: 0, orange: 1, rot: 2 };
        if (rank[photoStage.foto_status] > rank[status]) {
            status = photoStage.foto_status;
        }
    }

    const zusammenfassung =
        analyse.bewertung || parsed?.zusammenfassung || photoStage?.bewertung || '';
    const empfehlung = analyse.empfehlung
        ? [analyse.empfehlung]
        : Array.isArray(parsed?.empfehlungen)
          ? parsed.empfehlungen
          : photoStage?.empfehlung
            ? [photoStage.empfehlung]
            : [];
    const auffaelligkeiten = Array.isArray(analyse.warnsignale)
        ? analyse.warnsignale
        : Array.isArray(parsed?.auffaelligkeiten)
          ? parsed.auffaelligkeiten
          : photoStage?.foto_auffaelligkeiten || [];

    return {
        ampel: status,
        foto_hat_entschieden: true,
        titel: parsed?.titel || '',
        zusammenfassung,
        auffaelligkeiten: auffaelligkeiten.map(String),
        empfehlungen: empfehlung.map(String),
        studio_kontakt: Boolean(parsed?.studio_kontakt) || status === 'rot',
        naechster_check_tage: Number(parsed?.naechster_check_tage) || 7,
        hinweis:
            analyse.hinweis ||
            analyse.wichtiger_hinweis ||
            'Diese Analyse ersetzt keine medizinische Beurteilung. Bei Unsicherheit immer das Studio kontaktieren.',
    };
};

const aiUnavailableFallback = (stage) => {
    if (stage === 'photo') {
        return {
            foto_status: 'orange',
            foto_befund: 'KI-Analyse ist momentan nicht verfügbar.',
            foto_beschreibung: 'KI-Analyse ist momentan nicht verfügbar.',
            foto_auffaelligkeiten: [],
            nachfrage: 'Hast du Schmerzen oder Beschwerden an der behandelten Stelle?',
            wichtiger_hinweis:
                'Bitte kontaktieren Sie Ihr Studio bei Bedenken. Diese Analyse ersetzt keine medizinische Beurteilung.',
            bewertung: '',
            empfehlung: 'Bitte kontaktieren Sie das Studio bei Auffälligkeiten.',
            ai_available: false,
        };
    }
    return {
        ampel: 'orange',
        foto_hat_entschieden: false,
        titel: 'Manuelle Prüfung erforderlich',
        zusammenfassung:
            'KI-Analyse ist momentan nicht verfügbar. Das Studio wird Ihren Heilungsstand manuell beurteilen.',
        auffaelligkeiten: [],
        empfehlungen: ['Bitte kontaktieren Sie das Studio bei Bedenken oder Auffälligkeiten.'],
        studio_kontakt: true,
        naechster_check_tage: 7,
        hinweis:
            'Diese Analyse ersetzt keine medizinische Beurteilung. Bei Unsicherheit immer das Studio kontaktieren.',
        ai_available: false,
    };
};

const normalizeProgressionDirection = (value) => {
    const raw = String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    if (
        raw.includes('improv') ||
        raw.includes('besser') ||
        raw.includes('verbesser') ||
        raw.includes('reduced') ||
        raw.includes('reduziert')
    ) {
        return 'improved';
    }
    if (
        raw.includes('wors') ||
        raw.includes('schlechter') ||
        raw.includes('verschlechter') ||
        raw.includes('deterior') ||
        raw.includes('pronounced') ||
        raw.includes('ausgeprag')
    ) {
        return 'worsened';
    }
    if (
        raw.includes('unchang') ||
        raw.includes('unverand') ||
        raw.includes('gleich') ||
        raw.includes('no clear') ||
        raw.includes('keine klare')
    ) {
        return 'unchanged';
    }
    if (raw.includes('unclear') || raw.includes('unklar')) return 'unclear';
    return null;
};

const findPreviousAftercareCheck = async (caseId, zonenId) => {
    const filter = {
        case: caseId,
        foto_file_id: { $ne: null },
    };
    if (zonenId) {
        filter.zonen_id = zonenId;
    } else {
        filter.$or = [{ zonen_id: null }, { zonen_id: { $exists: false } }, { zonen_id: '' }];
    }
    return NachsorgeCheck.findOne(filter).sort({ createdAt: -1 }).lean();
};

const mapProgressionResult = (parsed, lang = 'de') => {
    const block = parsed?.progression || parsed?.verlauf || parsed || {};
    const direction =
        normalizeProgressionDirection(block.direction || block.richtung || block.progress_direction) ||
        'unclear';
    const summary =
        String(
            block.summary ||
                block.zusammenfassung ||
                block.beurteilung ||
                block.assessment ||
                ''
        ).trim() ||
        (lang === 'en'
            ? 'Visual change compared with the previous aftercare photo could not be determined clearly. This is not a medical diagnosis.'
            : 'Im Vergleich zum vorherigen Nachsorge-Foto konnte die visuelle Veränderung nicht klar bestimmt werden. Dies ist keine medizinische Diagnose.');
    return { direction, summary };
};

const formatCheck = (doc, role = 'studio') => {
    const d = doc.toObject ? doc.toObject() : doc;
    const customerRef =
        d.customer && typeof d.customer === 'object' && d.customer._id
            ? d.customer
            : null;
    const caseRef =
        d.case && typeof d.case === 'object' && d.case._id ? d.case : null;
    const customerView = isCustomer(role);
    const base = {
        id: String(d._id),
        case_id: String(caseRef ? caseRef._id : d.case),
        case_display_id: caseRef?.caseId ?? null,
        zonen_id: d.zonen_id ?? null,
        customer_id: String(customerRef ? customerRef._id : d.customer),
        studio_id: String(d.studio),
        foto_file_id: d.foto_file_id ? String(d.foto_file_id) : null,
        symptome: d.symptome || [],
        sitzungs_datum: d.sitzungs_datum,
        tage_nach_sitzung: d.tage_nach_sitzung,
        foto_status: d.foto_status,
        ampel: d.ampel,
        titel: d.titel,
        zusammenfassung: d.healing_customer_summary || d.zusammenfassung,
        empfehlungen: d.empfehlungen || [],
        studio_kontakt: !!d.studio_kontakt,
        naechster_check_tage: d.naechster_check_tage,
        hinweis: d.healing_customer_summary || d.hinweis,
        healing_status: d.healing_status || null,
        healing_phase: d.healing_phase || null,
        healing_customer_summary: d.healing_customer_summary || '',
        healing_recommended_action: d.healing_recommended_action || null,
        progress_direction_self: d.progress_direction_self || null,
        previous_check_id: d.previous_check_id ? String(d.previous_check_id) : null,
        previous_foto_file_id: d.previous_foto_file_id
            ? String(d.previous_foto_file_id)
            : null,
        progression_direction: d.progression_direction || null,
        progression_summary: d.progression_summary || '',
        erstellt_von: d.erstellt_von,
        erstellt_am: d.createdAt,
    };

    if (customerView) {
        return {
            ...base,
            customer_name: null,
            foto_befund: d.foto_befund,
            foto_auffaelligkeiten: [],
            healing_red_flag: false,
            healing_red_flags: [],
            healing_needs_review: false,
            healing_severity_score: null,
            healing_progress_score: null,
            healing_symptoms: null,
            healing_behavior: null,
            studio_review_notes: d.studio_review_notes || '',
            healing_status_calculated: null,
            healing_studio_reviewed_at: d.healing_studio_reviewed_at || null,
            healing_studio_reviewed_by: '',
        };
    }

    return {
        ...base,
        customer_name: customerRef
            ? [customerRef.vorname, customerRef.nachname].filter(Boolean).join(' ')
            : null,
        foto_befund: d.foto_befund,
        foto_auffaelligkeiten: d.foto_auffaelligkeiten || [],
        healing_red_flag: !!d.healing_red_flag,
        healing_red_flags: d.healing_red_flags || [],
        healing_needs_review: !!d.healing_needs_review,
        healing_severity_score: d.healing_severity_score ?? null,
        healing_progress_score: d.healing_progress_score ?? null,
        healing_symptoms: d.healing_symptoms || null,
        healing_behavior: d.healing_behavior || null,
        studio_review_notes: d.studio_review_notes || '',
        healing_status_calculated: d.healing_status_calculated || d.healing_status || null,
        healing_studio_reviewed_at: d.healing_studio_reviewed_at || null,
        healing_studio_reviewed_by: d.healing_studio_reviewed_by || '',
    };
};

const photoCheck = asyncHandler(async (req, res) => {
    const caseDoc = await loadOwnedCase(req.user, req.body.case_id);
   
    await resolveCheckZone(caseDoc, req.body.zonen_id);
    const tage = resolveTageNachSitzung(req.body.sitzungs_datum, caseDoc);
    const { buffer, mimeType } = await loadPhotoForAi(
        req.user,
        req.body.foto_file_id,
        caseDoc,
        req
    );

    if (!isAiEnabled()) {
        return res.status(200).json({
            success: true,
            data: {
                ...aiUnavailableFallback('photo'),
                tage_nach_sitzung: tage,
            },
        });
    }

    const featureGate = await assertAiFeatureAllowed(req.user, 'ki_nachsorge');
    if (!featureGate.allowed) {
        return res.status(200).json({
            success: true,
            data: {
                ...aiUnavailableFallback('photo'),
                tage_nach_sitzung: tage,
                feature_disabled: true,
            },
        });
    }

    const nachsorgeSystem =
        (await getAiSystemPrompt('nachsorge')) || ELAYA_NACHSORGE_SYSTEM;

    const tageLabel =
        tage !== null && tage >= 0 ? `${tage} Tage` : 'unbekannte Zeit';

    const { parsed } = await callClaude({
        system: nachsorgeSystem,
        maxTokens: 2048,
        messages: [
            {
                role: 'user',
                content: [
                    imageContentFromBuffer(buffer, mimeType),
                    {
                        type: 'text',
                        text: `Analysiere dieses Foto der behandelten Hautpartie nach Laser-Tattooentfernung.

ZEITKONTEXT: Es sind ${tageLabel} seit der letzten Laserbehandlung vergangen.

Beurteile den Heilungsfortschritt unter Berücksichtigung dieses Zeitraums.
Antworte nur als reines JSON ohne Markdown.`,
                    },
                ],
            },
        ],
    });

    const mapped = mapPhotoOnlyResult(parsed);

    res.status(200).json({
        success: true,
        data: {
            ...mapped,
            tage_nach_sitzung: tage,
            ai_available: true,
        },
    });
});

const createCheck = asyncHandler(async (req, res) => {
    const caseDoc = await loadOwnedCase(req.user, req.body.case_id);
    const zonenId = await resolveCheckZone(caseDoc, req.body.zonen_id);
    const sitzungsDatum = req.body.sitzungs_datum
        ? new Date(req.body.sitzungs_datum)
        : caseDoc.lastSessionDate || null;
    const tage = resolveTageNachSitzung(sitzungsDatum, caseDoc);
    const symptome = Array.isArray(req.body.symptome) ? req.body.symptome : [];

    const { fileAsset, buffer, mimeType } = await loadPhotoForAi(
        req.user,
        req.body.foto_file_id,
        caseDoc,
        req
    );

    const previousCheck = await findPreviousAftercareCheck(caseDoc._id, zonenId);
    let previousPhoto = null;
    if (previousCheck?.foto_file_id) {
        try {
            previousPhoto = await loadPhotoForAi(
                req.user,
                String(previousCheck.foto_file_id),
                caseDoc,
                req
            );
        } catch {
            previousPhoto = null;
        }
    }

    let photoStage;
    let combined;
    let rawAi = null;
    let progression = {
        direction: null,
        summary: '',
        previous_check_id: previousCheck?._id || null,
        previous_foto_file_id: previousCheck?.foto_file_id || null,
    };

    const healingLang =
        normalizePreferredLang(req.query?.lang) ||
        normalizePreferredLang(req.user?.preferred_language) ||
        'de';

    if (!isAiEnabled()) {
        photoStage = aiUnavailableFallback('photo');
        combined = aiUnavailableFallback('combined');
    } else {
        const featureGate = await assertAiFeatureAllowed(req.user, 'ki_nachsorge');
        if (!featureGate.allowed) {
            photoStage = { ...aiUnavailableFallback('photo'), feature_disabled: true };
            combined = { ...aiUnavailableFallback('combined'), feature_disabled: true };
        } else {
        const nachsorgeSystem =
            (await getAiSystemPrompt('nachsorge')) || ELAYA_NACHSORGE_SYSTEM;
        const tageLabel =
            tage !== null && tage >= 0 ? `${tage} Tage` : 'unbekannte Zeit';

        const photoCall = await callClaude({
            system: nachsorgeSystem,
            maxTokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: [
                        imageContentFromBuffer(buffer, mimeType),
                        {
                            type: 'text',
                            text: `Analysiere dieses Foto der behandelten Hautpartie nach Laser-Tattooentfernung.

ZEITKONTEXT: Es sind ${tageLabel} seit der letzten Laserbehandlung vergangen.

Antworte nur als reines JSON ohne Markdown.`,
                        },
                    ],
                },
            ],
        });
        photoStage = mapPhotoOnlyResult(photoCall.parsed);

        const befundText = `Foto-Status: ${photoStage.foto_status}
Foto-Befund: ${photoStage.foto_befund}
Auffälligkeiten: ${(photoStage.foto_auffaelligkeiten || []).join(', ') || 'keine'}`;
        const symText =
            symptome.length > 0 ? symptome.join(', ') : 'keine_beschwerden / keine angegeben';
        const tageText =
            tage !== null ? `${tage} Tage seit letzter Sitzung` : 'Zeitraum unbekannt';

        const combinedCall = await callClaude({
            system: nachsorgeSystem,
            maxTokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: [
                        imageContentFromBuffer(buffer, mimeType),
                        {
                            type: 'text',
                            text: `Foto-Analyse (Stufe 1):\n${befundText}\n\nSYMPTOME: ${symText} · ${tageText}\n\nKombiniere Foto-Analyse und Symptome. Das Foto hat IMMER Priorität — Symptome dürfen die Ampel nicht verbessern.\nAntworte nur als reines JSON ohne Markdown.`,
                        },
                    ],
                },
            ],
        });
        combined = mapCombinedResult(combinedCall.parsed, photoStage);
        combined.ai_available = true;
        rawAi = {
            photo: photoCall.parsed,
            combined: combinedCall.parsed,
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
        };

        if (previousPhoto?.buffer) {
            const prevDate = previousCheck.createdAt
                ? new Date(previousCheck.createdAt).toISOString().slice(0, 10)
                : 'unbekannt';
            const progressionCall = await callClaude({
                system: nachsorgeSystem,
                maxTokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: [
                            imageContentFromBuffer(
                                previousPhoto.buffer,
                                previousPhoto.mimeType
                            ),
                            {
                                type: 'text',
                                text: `VORHERIGES NACHSORGE-FOTO (Referenz vom ${prevDate}). Ampel damals: ${previousCheck.ampel || 'unbekannt'}.`,
                            },
                            imageContentFromBuffer(buffer, mimeType),
                            {
                                type: 'text',
                                text: `AKTUELLES NACHSORGE-FOTO (${tageText}).

Vergleiche die beiden Fotos derselben behandelten Stelle. Beschreibe den visuellen Verlauf (z.B. Rötung abgenommen/zugenommen, Bläschen stärker/schwächer, Heilung verbessert/verschlechtert/keine klare Änderung).

WICHTIG:
- Dies ist KEINE medizinische Diagnose.
- Antworte nur als reines JSON ohne Markdown:
{
  "progression": {
    "direction": "improved" | "worsened" | "unchanged" | "unclear",
    "summary": "Kurze, verständliche Verlaufsbeschreibung auf ${healingLang === 'en' ? 'Englisch' : 'Deutsch'} (1–3 Sätze). Am Ende klar sagen, dass es keine medizinische Diagnose ist."
  }
}`,
                            },
                        ],
                    },
                ],
            });
            const mappedProgression = mapProgressionResult(
                progressionCall.parsed,
                healingLang
            );
            progression.direction = mappedProgression.direction;
            progression.summary = mappedProgression.summary;
            rawAi.progression = progressionCall.parsed;
        }
        } // featureGate.allowed
    }

    const healing = computeHealingAssessment({
        lang: healingLang,
        days_since_session: tage,
        symptome,
        photo_ampel: photoStage.foto_status || combined.ampel,
        erythema_level: req.body.erythema_level,
        swelling_level: req.body.swelling_level,
        blistering_flag: req.body.blistering_flag,
        crusting_level: req.body.crusting_level,
        pain_score: req.body.pain_score,
        itching_level: req.body.itching_level,
        hyperpigmentation_level: req.body.hyperpigmentation_level,
        hypopigmentation_level: req.body.hypopigmentation_level,
        infection_suspected: req.body.infection_suspected,
        oozing: req.body.oozing,
        warmth: req.body.warmth,
        open_lesion: req.body.open_lesion,
        progress_direction_self: req.body.progress_direction_self,
        concern_flag: req.body.concern_flag,
        sun_avoidance: req.body.sun_avoidance,
        spf_use: req.body.spf_use,
        aftercare_use: req.body.aftercare_use,
        scratching_behavior: req.body.scratching_behavior,
        early_sport_flag: req.body.early_sport_flag,
        current_sleep_quality: req.body.current_sleep_quality,
        current_stress_level: req.body.current_stress_level,
        current_hydration_level: req.body.current_hydration_level,
        recent_alcohol_excess: req.body.recent_alcohol_excess,
    });

    combined.ampel = worseAmpel(combined.ampel, healing.ampel);
    combined.studio_kontakt = combined.studio_kontakt || healing.studio_kontakt;
    // Prefer localized rule-engine copy for the customer-facing summary so
    // `?lang=en` never shows German template text from AI/default fallbacks.
    if (healing.customer_summary) {
        combined.zusammenfassung = healing.customer_summary;
        combined.hinweis = healing.customer_summary;
    }
    if (healing.recommended_action_text && !(combined.empfehlungen || []).includes(healing.recommended_action_text)) {
        combined.empfehlungen = [healing.recommended_action_text, ...(combined.empfehlungen || [])];
    }
    if (progression.summary) {
        combined.empfehlungen = [progression.summary, ...(combined.empfehlungen || [])];
    }

    const studioId = caseDoc.studio || caseDoc.aktuelle_firma_id;
    const check = await NachsorgeCheck.create({
        customer: caseDoc.customer,
        case: caseDoc._id,
        zonen_id: zonenId,
        studio: studioId,
        foto_file_id: fileAsset._id,
        symptome,
        sitzungs_datum: sitzungsDatum,
        tage_nach_sitzung: tage,
        foto_status: photoStage.foto_status,
        foto_befund: photoStage.foto_befund,
        foto_auffaelligkeiten: photoStage.foto_auffaelligkeiten,
        ampel: combined.ampel,
        titel: combined.titel,
        zusammenfassung: combined.zusammenfassung,
        empfehlungen: combined.empfehlungen,
        studio_kontakt: combined.studio_kontakt,
        naechster_check_tage: combined.naechster_check_tage,
        hinweis: combined.hinweis,
        healing_status: healing.healing_status,
        healing_phase: healing.healing_phase,
        healing_severity_score: healing.severity_score,
        healing_red_flag: healing.red_flag,
        healing_red_flags: healing.red_flags,
        healing_needs_review: healing.needs_human_review,
        healing_customer_summary: healing.customer_summary,
        healing_progress_score: healing.healing_progress_score,
        healing_recommended_action: healing.recommended_action,
        healing_symptoms: healing.symptoms,
        healing_behavior: healing.behavior,
        progress_direction_self: req.body.progress_direction_self || null,
        previous_check_id: progression.previous_check_id,
        previous_foto_file_id: progression.previous_foto_file_id,
        progression_direction: progression.direction,
        progression_summary: progression.summary || '',
        healing_status_calculated: healing.healing_status,
        raw_ai: rawAi,
        erstellt_von: isCustomer(req.user.role) ? 'customer' : 'studio',
    });

    if (fileAsset.status === FILE_STATUS.STAGING) {
        fileAsset.case = caseDoc._id;
        fileAsset.status = FILE_STATUS.ACTIVE;
        fileAsset.expires_at = undefined;
        await fileAsset.save();
    }

    let coinsAwarded = 0;
    if (isCustomer(req.user.role) || isStudio(req.user.role) || isAdmin(req.user.role)) {
        coinsAwarded = await vergebeElaycoins(caseDoc.customer, 'nachsorge_check', {
            case_id: caseDoc._id,
            nachsorge_check_id: check._id,
        });
    }

    const latestSession = await Session.findOne({
        case: caseDoc._id,
        is_draft: false,
        is_no_show: false,
    }).sort({ session_number: -1 });
    if (latestSession) {
        await evaluateAndApplySessionLightening(latestSession, caseDoc, {
            progress_direction_self: req.body.progress_direction_self,
            sleep_quality: req.body.current_sleep_quality,
            stress_level: req.body.current_stress_level,
        });
        if (latestSession.isModified()) await latestSession.save();
    }

    res.status(201).json({
        success: true,
        message: 'Nachsorge-Check gespeichert',
        data: {
            check: formatCheck(check, req.user.role),
            photo_stage: {
                foto_status: photoStage.foto_status,
                foto_befund: photoStage.foto_befund,
                foto_auffaelligkeiten: photoStage.foto_auffaelligkeiten,
            },
            result: {
                ampel: combined.ampel,
                titel: combined.titel,
                zusammenfassung: healing.customer_summary || combined.zusammenfassung,
                empfehlungen: combined.empfehlungen,
                studio_kontakt: combined.studio_kontakt,
                naechster_check_tage: combined.naechster_check_tage,
                hinweis: healing.customer_summary || combined.hinweis,
                ai_available: combined.ai_available !== false,
                healing_status: healing.healing_status,
                healing_phase: healing.healing_phase,
                healing_customer_summary: healing.customer_summary,
                healing_recommended_action: healing.recommended_action,
                progression_direction: progression.direction,
                progression_summary: progression.summary || '',
                ...(isCustomer(req.user.role)
                    ? {}
                    : {
                          healing_needs_review: healing.needs_human_review,
                          healing_red_flag: healing.red_flag,
                          healing_progress_score: healing.healing_progress_score,
                          healing_red_flags: healing.red_flags,
                      }),
            },
            elaycoins_awarded: coinsAwarded,
        },
    });
});

const listChecks = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (isCustomer(req.user.role)) {
        filter.customer = req.user.customer_id;
    } else if (isStudio(req.user.role)) {
        filter.studio = req.user.studio_id;
    } else if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    if (req.query.case_id) {
        filter.case = req.query.case_id;
        if (isCustomer(req.user.role) || isStudio(req.user.role)) {
            await loadOwnedCase(req.user, req.query.case_id);
        }
    }

    if (req.query.zonen_id) {
        filter.zonen_id = req.query.zonen_id;
    }

    const [rows, total] = await Promise.all([
        NachsorgeCheck.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-raw_ai')
            .populate('customer', 'vorname nachname')
            .populate('case', 'caseId')
            .lean(),
        NachsorgeCheck.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            checks: rows.map((row) => formatCheck(row, req.user.role)),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const getCheck = asyncHandler(async (req, res) => {
    const check = await NachsorgeCheck.findById(req.params.id)
        .select('-raw_ai')
        .populate('customer', 'vorname nachname')
        .populate('case', 'caseId')
        .lean();
    if (!check) throw new ApiError(404, 'Nachsorge check not found');

    if (isCustomer(req.user.role)) {
        if (refId(check.customer) !== refId(req.user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this check');
        }
    } else if (isStudio(req.user.role)) {
        if (refId(check.studio) !== refId(req.user.studio_id)) {
            const caseDoc = await Case.findById(refId(check.case)).select('customer studio').lean();
            if (caseDoc) await assertCaseAccess(req.user, caseDoc);
            else throw new ApiError(403, 'You do not have access to this check');
        }
    } else if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    res.status(200).json({
        success: true,
        data: { check: formatCheck(check, req.user.role) },
    });
});

const reviewCheck = asyncHandler(async (req, res) => {
    if (isCustomer(req.user.role)) {
        throw new ApiError(403, 'Only studio staff or admin can review aftercare');
    }

    const check = await NachsorgeCheck.findById(req.params.id);
    if (!check) throw new ApiError(404, 'Nachsorge check not found');

    const caseDoc = await Case.findById(check.case);
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    await assertCaseWriteAccess(req.user, caseDoc);

    if (!check.healing_status_calculated) {
        check.healing_status_calculated = check.healing_status;
    }

    if (req.body.studio_review_notes != null) {
        check.studio_review_notes = String(req.body.studio_review_notes);
    }

    if (req.body.healing_status) {
        const correctionLang =
            normalizePreferredLang(req.query?.lang) ||
            normalizePreferredLang(req.user?.preferred_language) ||
            'de';
        const correction = applyStudioHealingCorrection(
            check,
            req.body.healing_status,
            correctionLang
        );
        check.healing_status = correction.healing_status;
        check.ampel = correction.ampel;
        check.studio_kontakt = correction.studio_kontakt;
        check.healing_needs_review = false;
        check.healing_customer_summary = correction.customer_summary;
        check.healing_recommended_action = correction.recommended_action;
        check.hinweis = correction.customer_summary;
        check.zusammenfassung = correction.customer_summary;
    } else {
        check.healing_needs_review = false;
    }

    check.healing_studio_reviewed_at = new Date();
    check.healing_studio_reviewed_by = req.user.email || String(req.user._id);
    await check.save();

    const latestSession = await Session.findOne({
        case: check.case,
        is_draft: false,
        is_no_show: false,
    }).sort({ session_number: -1 });
    if (latestSession) {
        await evaluateAndApplySessionLightening(latestSession, caseDoc, {
            studio_review_pct: latestSession.lightening_studio_pct,
        });
        if (latestSession.isModified()) await latestSession.save();
    }

    const populated = await NachsorgeCheck.findById(check._id)
        .select('-raw_ai')
        .populate('customer', 'vorname nachname')
        .populate('case', 'caseId')
        .lean();

    require('../utils/openActionService').publishOpenActionsChanged(check.studio);

    res.status(200).json({
        success: true,
        message: 'Studio-Review gespeichert',
        data: { check: formatCheck(populated, req.user.role) },
    });
});

const contactStudio = asyncHandler(async (req, res) => {
    const check = await NachsorgeCheck.findById(req.params.id)
        .populate('case', 'caseId customer studio')
        .lean();
    if (!check) throw new ApiError(404, 'Nachsorge check not found');

    const caseRef =
        check.case && typeof check.case === 'object' && check.case._id
            ? check.case
            : null;
    const caseId = caseRef ? caseRef._id : check.case;
    const caseDoc = caseRef || (await Case.findById(caseId).select('caseId customer studio').lean());
    if (!caseDoc) throw new ApiError(404, 'Case not found');

    await assertCaseAccess(req.user, caseDoc);

    if (isCustomer(req.user.role) && refId(caseDoc.customer) !== refId(req.user.customer_id)) {
        throw new ApiError(403, 'You do not have access to this check');
    }

    const studioId = refId(caseDoc.studio) || refId(check.studio);
    if (!studioId) {
        throw new ApiError(400, 'Case has no studio assigned');
    }

    const Studio = require('../models/studioModel');
    const { activeStandorte } = require('../utils/studioHours');
    const studio = await Studio.findById(studioId)
        .select('firma standorte strasse plz ort')
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');

    const locations = activeStandorte(studio);
    const requestedStandortId =
        typeof req.body.standort_id === 'string' ? req.body.standort_id.trim() : '';

    let standort = null;
    if (requestedStandortId) {
        standort = locations.find((s) => String(s._id) === requestedStandortId) || null;
        if (!standort) {
            throw new ApiError(
                400,
                'standort_id does not belong to this case’s studio company'
            );
        }
    } else if (locations.length === 1) {
        standort = locations[0];
    } else if (locations.length > 1) {
        throw new ApiError(400, 'standort_id is required when multiple locations exist');
    }

    const messagingService = require('../services/messagingService');
    const { emitMessageCreated } = require('../sockets/emitHelpers');

    const conversation = await messagingService.getOrCreateConversationForPair(
        refId(caseDoc.customer),
        studioId
    );

    const { formatCaseRef, formatCaseLabel } = require('../utils/formatCaseRef');
    const caseDisplay = formatCaseRef(caseDoc.caseId || String(caseId).slice(-6));
    const checkAt = check.createdAt
        ? new Date(check.createdAt).toLocaleString('de-CH', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          })
        : '—';
    const ampel = check.ampel || '—';
    const healingStatus = check.healing_status || '—';
    const standortName = standort?.name || studio.firma || 'Studio';
    const deepLink = `/studio/aftercare?check=${check._id}`;

    const text = [
        `Aftercare Alert – ${formatCaseLabel(caseDisplay)}`,
        '',
        `Standort: ${standortName}`,
        `Check: ${checkAt}`,
        `Risiko / Ampel: ${ampel}`,
        `Heilungsstatus: ${healingStatus}`,
        '',
        'Der Kunde meldet sich wegen eines auffälligen Nachsorge-Checks.',
        `Nachsorge-Check öffnen: ${deepLink}`,
        '',
        'Dies ist keine medizinische Diagnose.',
    ].join('\n');

    const payload = await messagingService.postSystemMessage(conversation.id, {
        text,
        case_id: caseId,
        meta: {
            kind: 'aftercare_alert',
            nachsorge_check_id: String(check._id),
            case_id: String(caseId),
            case_display_id: caseDisplay,
            standort_id: standort ? String(standort._id) : null,
            standort_name: standortName,
            ampel,
            healing_status: healingStatus,
            foto_file_id: check.foto_file_id ? String(check.foto_file_id) : null,
            erstellt_am: check.createdAt || null,
            deep_link: deepLink,
        },
    });

    emitMessageCreated(payload);

    res.status(200).json({
        success: true,
        message: 'Studio chat opened with aftercare alert',
        data: {
            conversation: payload.conversation,
            message: payload.message,
            studio: {
                id: studioId,
                firma: studio.firma || '',
            },
            standort: standort
                ? {
                      id: String(standort._id),
                      name: standort.name,
                      strasse: standort.strasse || '',
                      plz: standort.plz || '',
                      ort: standort.ort || '',
                  }
                : null,
            check_id: String(check._id),
            case_id: String(caseId),
            case_display_id: caseDisplay,
        },
    });
});

module.exports = {
    photoCheck,
    createCheck,
    listChecks,
    getCheck,
    reviewCheck,
    contactStudio,
};
