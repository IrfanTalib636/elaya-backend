const Case = require('../models/caseModel');
const FileAsset = require('../models/fileAssetModel');
const NachsorgeCheck = require('../models/nachsorgeCheckModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isCustomer, isStudio, isAdmin, refId } = require('../utils/accessHelpers');
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

const formatCheck = (doc) => {
    const d = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(d._id),
        case_id: String(d.case),
        customer_id: String(d.customer),
        studio_id: String(d.studio),
        foto_file_id: d.foto_file_id ? String(d.foto_file_id) : null,
        symptome: d.symptome || [],
        sitzungs_datum: d.sitzungs_datum,
        tage_nach_sitzung: d.tage_nach_sitzung,
        foto_status: d.foto_status,
        foto_befund: d.foto_befund,
        foto_auffaelligkeiten: d.foto_auffaelligkeiten || [],
        ampel: d.ampel,
        titel: d.titel,
        zusammenfassung: d.zusammenfassung,
        empfehlungen: d.empfehlungen || [],
        studio_kontakt: !!d.studio_kontakt,
        naechster_check_tage: d.naechster_check_tage,
        hinweis: d.hinweis,
        erstellt_von: d.erstellt_von,
        erstellt_am: d.createdAt,
    };
};

// ── POST /nachsorge/photo-check ───────────────────────────────────────────
const photoCheck = asyncHandler(async (req, res) => {
    const caseDoc = await loadOwnedCase(req.user, req.body.case_id);
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

    const studioId = caseDoc.studio || caseDoc.aktuelle_firma_id;
    const check = await NachsorgeCheck.create({
        customer: caseDoc.customer,
        case: caseDoc._id,
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

    res.status(201).json({
        success: true,
        message: 'Nachsorge-Check gespeichert',
        data: {
            check: formatCheck(check),
            photo_stage: {
                foto_status: photoStage.foto_status,
                foto_befund: photoStage.foto_befund,
                foto_auffaelligkeiten: photoStage.foto_auffaelligkeiten,
            },
            result: {
                ampel: combined.ampel,
                titel: combined.titel,
                zusammenfassung: combined.zusammenfassung,
                empfehlungen: combined.empfehlungen,
                studio_kontakt: combined.studio_kontakt,
                naechster_check_tage: combined.naechster_check_tage,
                hinweis: combined.hinweis,
                ai_available: combined.ai_available !== false,
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

    const [rows, total] = await Promise.all([
        NachsorgeCheck.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('-raw_ai')
            .lean(),
        NachsorgeCheck.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            checks: rows.map(formatCheck),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

// ── GET /nachsorge/:id ────────────────────────────────────────────────────
const getCheck = asyncHandler(async (req, res) => {
    const check = await NachsorgeCheck.findById(req.params.id).select('-raw_ai').lean();
    if (!check) throw new ApiError(404, 'Nachsorge check not found');

    if (isCustomer(req.user.role)) {
        if (refId(check.customer) !== refId(req.user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this check');
        }
    } else if (isStudio(req.user.role)) {
        if (refId(check.studio) !== refId(req.user.studio_id)) {
            // allow if customer currently assigned here
            const caseDoc = await Case.findById(check.case).select('customer studio').lean();
            if (caseDoc) await assertCaseAccess(req.user, caseDoc);
            else throw new ApiError(403, 'You do not have access to this check');
        }
    } else if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    res.status(200).json({
        success: true,
        data: { check: formatCheck(check) },
    });
});

module.exports = {
    photoCheck,
    createCheck,
    listChecks,
    getCheck,
};
