const mongoose = require('mongoose');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const FileAsset = require('../models/fileAssetModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    assertSessionAccess,
    assertCaseAccess,
    isCustomer,
    isStudio,
    isAdmin,
} = require('../utils/accessHelpers');
const { assertFileAccess, logFileAccess } = require('../services/fileAccessService');
const { readFileBuffer } = require('../services/fileStorageService');
const {
    FILE_AUDIT_ACTION,
    FILE_STATUS,
    FILE_PURPOSE,
} = require('../config/storageConfig');
const { ELAYA_VERBLASSUNG_SYSTEM } = require('../content/aiPrompts');
const {
    callClaude,
    imageContentFromBuffer,
    isAiEnabled,
} = require('../services/anthropicService');
const { syncCaseSessionStats } = require('../utils/sessionHelpers');

const isObjectId = (value) =>
    typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

const clampPercent = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
};

const loadPhotoBuffer = async (user, fileId, req, meta = {}) => {
    const fileAsset = await FileAsset.findById(fileId);
    if (!fileAsset || fileAsset.status === FILE_STATUS.DELETED) {
        throw new ApiError(404, 'Photo file not found');
    }
    await assertFileAccess(user, fileAsset);
    const buffer = await readFileBuffer(fileAsset.storage_path);
    await logFileAccess(fileAsset._id, user, FILE_AUDIT_ACTION.AI_ANALYZE, req, meta);
    return {
        fileAsset,
        buffer,
        mimeType: fileAsset.mime_type || 'image/jpeg',
        id: String(fileAsset._id),
    };
};

const resolveProgressFileIdForSession = async (sessionDoc) => {
    if (sessionDoc.fortschritt_foto_file_id) {
        return String(sessionDoc.fortschritt_foto_file_id);
    }
    if (isObjectId(sessionDoc.fortschritt_foto_data)) {
        return sessionDoc.fortschritt_foto_data;
    }
    const linked = await FileAsset.findOne({
        session: sessionDoc._id,
        purpose: FILE_PURPOSE.SESSION_PROGRESS,
        status: { $ne: FILE_STATUS.DELETED },
    })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean();
    return linked ? String(linked._id) : null;
};

const FIRST_SESSION_AI_MESSAGE =
    'KI-Verblassungsanalyse ist erst ab der zweiten Behandlung möglich. Für die erste Sitzung bitte nur das Vorher-Foto speichern — es wird ab Sitzung 2 für den Vergleich benötigt.';

/** Previous completed treatment photo only — never the intake photo, never session 1. */
const resolvePreviousTreatmentPhotoId = async (sessionDoc) => {
    const prev = await Session.findOne({
        case: sessionDoc.case,
        _id: { $ne: sessionDoc._id },
        session_number: { $lt: sessionDoc.session_number },
        is_no_show: false,
        is_draft: false,
    })
        .sort({ session_number: -1 })
        .lean();

    if (!prev) return null;
    return resolveProgressFileIdForSession(prev);
};

const mapVerblassungResult = (parsed) => {
    const pct =
        clampPercent(parsed?.verblassung_prozent) ??
        clampPercent(parsed?.prozent) ??
        null;

    return {
        verblassung_prozent: pct,
        status: String(parsed?.status || '').trim() || '',
        farben_analyse:
            parsed?.farben_analyse && typeof parsed.farben_analyse === 'object'
                ? parsed.farben_analyse
                : null,
        beurteilung: String(
            parsed?.beurteilung || parsed?.begruendung || ''
        ).trim(),
        fortschritt: String(parsed?.fortschritt || '').trim(),
        lifestyle_tipps: String(parsed?.lifestyle_tipps || '').trim(),
        empfehlung_kunde: String(
            parsed?.empfehlung_kunde ||
                parsed?.empfehlung_naechste_sitzung ||
                parsed?.empfehlung ||
                ''
        ).trim(),
        empfehlung_studio: String(parsed?.empfehlung_studio || '').trim(),
        wichtiger_hinweis: String(
            parsed?.wichtiger_hinweis ||
                'Diese Analyse ist eine visuelle Schätzung und ersetzt keine professionelle Beurteilung durch das Studio.'
        ).trim(),
    };
};

const formatCustomerKi = (ki) => {
    if (!ki) return null;
    return {
        status: ki.status || '',
        beurteilung: ki.beurteilung || '',
        fortschritt: ki.fortschritt || '',
        lifestyle_tipps: ki.lifestyle_tipps || '',
        empfehlung_kunde: ki.empfehlung_kunde || '',
        wichtiger_hinweis: ki.wichtiger_hinweis || '',
        farben_analyse: ki.farben_analyse || null,
        analysed_at: ki.analysed_at || null,
    };
};

const formatStudioKi = (ki) => {
    if (!ki) return null;
    return {
        ...formatCustomerKi(ki),
        empfehlung_studio: ki.empfehlung_studio || '',
        foto_vorher_file_id: ki.foto_vorher_file_id || '',
        foto_aktuell_file_id: ki.foto_aktuell_file_id || '',
    };
};

const aiUnavailableFallback = () => ({
    verblassung_prozent: null,
    status: 'nicht_verfuegbar',
    farben_analyse: null,
    beurteilung: 'KI-Verblassungsanalyse ist momentan nicht verfügbar.',
    fortschritt: '',
    lifestyle_tipps: '',
    empfehlung_kunde: 'Bitte warten Sie auf die Einschätzung Ihres Studios.',
    empfehlung_studio: 'Manuelle Verblassungsschätzung erforderlich.',
    wichtiger_hinweis:
        'Diese Analyse ist eine visuelle Schätzung und ersetzt keine professionelle Beurteilung durch das Studio.',
    ai_available: false,
});

// ── POST /verblassung ─────────────────────────────────────────────────────
const analyzeVerblassung = asyncHandler(async (req, res) => {
    if (isCustomer(req.user.role)) {
        throw new ApiError(403, 'Only studio or admin can run Verblassung AI');
    }

    const sessionDoc = await Session.findById(req.body.session_id);
    if (!sessionDoc) throw new ApiError(404, 'Session not found');
    await assertSessionAccess(req.user, sessionDoc);

    const caseDoc = await Case.findById(sessionDoc.case);
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    await assertCaseAccess(req.user, caseDoc);

    if (Number(sessionDoc.session_number) < 2) {
        throw new ApiError(400, FIRST_SESSION_AI_MESSAGE);
    }

    const aktuellId =
        req.body.foto_aktuell_file_id ||
        (await resolveProgressFileIdForSession(sessionDoc));
    if (!aktuellId) {
        throw new ApiError(
            400,
            'No current progress photo — upload via POST /files/sessions/:sessionId/progress or pass foto_aktuell_file_id'
        );
    }

    const vorherId =
        req.body.foto_vorher_file_id || (await resolvePreviousTreatmentPhotoId(sessionDoc));
    if (!vorherId) {
        throw new ApiError(400, FIRST_SESSION_AI_MESSAGE);
    }

    const aktuell = await loadPhotoBuffer(req.user, aktuellId, req, {
        session_id: String(sessionDoc._id),
        role: 'aktuell',
    });
    const vorher = await loadPhotoBuffer(req.user, vorherId, req, {
        session_id: String(sessionDoc._id),
        role: 'vorher',
    });

    const persist = req.body.persist !== false;
    const sitzungNr = sessionDoc.session_number || 1;
    const estimated = caseDoc.sessions || caseDoc.sessionsMax || 8;

    let mapped;
    let rawAi = null;

    if (!isAiEnabled()) {
        mapped = aiUnavailableFallback();
    } else {
        const content = [
            imageContentFromBuffer(vorher.buffer, vorher.mimeType),
            {
                type: 'text',
                text: 'VORHER-BILD: Tattoo nach der vorherigen Laserbehandlung (Referenz)',
            },
            imageContentFromBuffer(aktuell.buffer, aktuell.mimeType),
            {
                type: 'text',
                text: `NACHHER-BILD: Tattoo aktuell vor Sitzung ${sitzungNr} von geschätzt ${estimated}. Analysiere den Verblassungsfortschritt und antworte nur als reines JSON.`,
            },
        ];

        const { parsed } = await callClaude({
            system: ELAYA_VERBLASSUNG_SYSTEM,
            maxTokens: 2048,
            messages: [{ role: 'user', content }],
        });

        mapped = { ...mapVerblassungResult(parsed), ai_available: true };
        rawAi = {
            parsed,
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
            compared: true,
        };
    }

    const kiPayload = {
        status: mapped.status,
        beurteilung: mapped.beurteilung,
        fortschritt: mapped.fortschritt,
        lifestyle_tipps: mapped.lifestyle_tipps,
        empfehlung_kunde: mapped.empfehlung_kunde,
        empfehlung_studio: mapped.empfehlung_studio,
        farben_analyse: mapped.farben_analyse,
        wichtiger_hinweis: mapped.wichtiger_hinweis,
        analysed_at: new Date(),
        foto_vorher_file_id: vorher.id,
        foto_aktuell_file_id: aktuell.id,
    };

    if (persist && mapped.verblassung_prozent != null) {
        sessionDoc.verblassung_prozent = mapped.verblassung_prozent;
        sessionDoc.removal_pct = mapped.verblassung_prozent;
        sessionDoc.verblassung_ki = kiPayload;
        sessionDoc.verblassung_raw_ai = rawAi;
        if (!sessionDoc.fortschritt_foto_file_id) {
            sessionDoc.fortschritt_foto_file_id = aktuell.fileAsset._id;
        }
        await sessionDoc.save();
        await syncCaseSessionStats(sessionDoc.case);
    } else if (persist) {
        sessionDoc.verblassung_ki = kiPayload;
        sessionDoc.verblassung_raw_ai = rawAi;
        await sessionDoc.save();
    }

    const forStudio = isStudio(req.user.role) || isAdmin(req.user.role);

    res.status(200).json({
        success: true,
        message: persist ? 'Verblassungsanalyse gespeichert' : 'Verblassungsanalyse (nicht gespeichert)',
        data: {
            session_id: String(sessionDoc._id),
            case_id: String(sessionDoc.case),
            verblassung_prozent: mapped.verblassung_prozent,
            compared: true,
            foto_vorher_file_id: vorher.id,
            foto_aktuell_file_id: aktuell.id,
            result: forStudio ? formatStudioKi(kiPayload) : formatCustomerKi(kiPayload),
            ai_available: mapped.ai_available !== false,
            persisted: persist,
        },
    });
});

module.exports = {
    analyzeVerblassung,
    formatCustomerKi,
    formatStudioKi,
};
