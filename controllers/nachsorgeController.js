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
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

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
            studio_review_notes: '',
            healing_status_calculated: null,
            healing_studio_reviewed_at: null,
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

// ── POST /nachsorge/photo-check ───────────────────────────────────────────
const photoCheck = asyncHandler(async (req, res) => {
    const caseDoc = await loadOwnedCase(req.user, req.body.case_id);
    // Validated here too, so the customer is told about a missing zone before
    // spending an AI call rather than after it.
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

    const tageLabel =
        tage !== null && tage >= 0 ? `${tage} Tage` : 'unbekannte Zeit';

    const { parsed } = await callClaude({
        system: ELAYA_NACHSORGE_SYSTEM,
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

// ── POST /nachsorge/check ─────────────────────────────────────────────────
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

    let photoStage;
    let combined;
    let rawAi = null;

    if (!isAiEnabled()) {
        photoStage = aiUnavailableFallback('photo');
        combined = aiUnavailableFallback('combined');
    } else {
        const tageLabel =
            tage !== null && tage >= 0 ? `${tage} Tage` : 'unbekannte Zeit';

        const photoCall = await callClaude({
            system: ELAYA_NACHSORGE_SYSTEM,
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
            system: ELAYA_NACHSORGE_SYSTEM,
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
    }

    const healing = computeHealingAssessment({
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
    if (healing.customer_summary && !combined.zusammenfassung) {
        combined.zusammenfassung = healing.customer_summary;
    }
    if (healing.recommended_action_text && !(combined.empfehlungen || []).includes(healing.recommended_action_text)) {
        combined.empfehlungen = [healing.recommended_action_text, ...(combined.empfehlungen || [])];
    }
    if (healing.customer_summary) {
        combined.hinweis = healing.customer_summary;
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
        healing_status_calculated: healing.healing_status,
        raw_ai: rawAi,
        erstellt_von: isCustomer(req.user.role) ? 'customer' : 'studio',
    });

    // Mark photo as linked to this case when still staging
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

// ── GET /nachsorge ────────────────────────────────────────────────────────
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

    // Lets a client show one zone's healing history on its own.
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

// ── GET /nachsorge/:id ────────────────────────────────────────────────────
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
            // allow if customer currently assigned here
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
        const correction = applyStudioHealingCorrection(check, req.body.healing_status);
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

    res.status(200).json({
        success: true,
        message: 'Studio-Review gespeichert',
        data: { check: formatCheck(populated, req.user.role) },
    });
});

module.exports = {
    photoCheck,
    createCheck,
    listChecks,
    getCheck,
    reviewCheck,
};
