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
} = require('../config/storageConfig');
const { ELAYA_VERBLASSUNG_SYSTEM } = require('../content/aiPrompts');
const {
    callClaude,
    imageContentFromBuffer,
    isAiEnabled,
} = require('../services/anthropicService');
const { syncCaseSessionStats } = require('../utils/sessionHelpers');
const {
    evaluateAndApplySessionLightening,
    resolvePreviousTreatment,
    resolveProgressFileIdForSession,
} = require('../utils/lighteningSessionService');

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

const FIRST_SESSION_AI_MESSAGE =
    'KI-Verblassungsanalyse ist erst ab der zweiten Behandlung möglich. Für die erste Sitzung bitte nur das Vorher-Foto speichern — es wird ab Sitzung 2 für den Vergleich benötigt.';

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

const formatCustomerKi = (ki, comparison = null) => {
    if (!ki) return null;
    const eligible = comparison?.customer_progress_visible !== false && comparison?.comparison_eligible !== false;
    const base = {
        status: ki.status || '',
        beurteilung: ki.beurteilung || '',
        fortschritt: ki.fortschritt || '',
        lifestyle_tipps: ki.lifestyle_tipps || '',
        empfehlung_kunde: ki.empfehlung_kunde || '',
        wichtiger_hinweis: ki.wichtiger_hinweis || '',
        farben_analyse: ki.farben_analyse || null,
        analysed_at: ki.analysed_at || null,
        comparison_eligible: comparison?.comparison_eligible ?? ki.comparison_eligible ?? null,
        uncertainty_level: comparison?.uncertainty_level || ki.uncertainty_level || null,
        progress_direction: eligible
            ? comparison?.progress_direction || ki.progress_direction || null
            : 'unclear',
        percent_estimate: eligible ? comparison?.percent_estimate ?? ki.percent_estimate ?? null : null,
        lightening_note_key: eligible ? null : comparison?.customer_message || 'no_reliable_comparison',
    };
    if (!eligible) {
        return {
            ...base,
            farben_analyse: null,
            fortschritt: '',
            percent_estimate: null,
            beurteilung:
                comparison?.customer_message === 'too_early'
                    ? 'Ein Vergleich ist noch zu früh (unter 14 Tagen). Ein zuverlässiger Verblassungsfortschritt kann noch nicht angezeigt werden.'
                    : 'Kein zuverlässiger Bildvergleich möglich. Ein Fortschrittswert wird deshalb nicht als sicheres Ergebnis angezeigt.',
        };
    }
    return base;
};

const formatStudioKi = (ki, comparison = null) => {
    if (!ki) return null;
    return {
        status: ki.status || '',
        beurteilung: ki.beurteilung || '',
        fortschritt: ki.fortschritt || '',
        lifestyle_tipps: ki.lifestyle_tipps || '',
        empfehlung_kunde: ki.empfehlung_kunde || '',
        empfehlung_studio: ki.empfehlung_studio || '',
        wichtiger_hinweis: ki.wichtiger_hinweis || '',
        farben_analyse: ki.farben_analyse || null,
        analysed_at: ki.analysed_at || null,
        foto_vorher_file_id: ki.foto_vorher_file_id || '',
        foto_aktuell_file_id: ki.foto_aktuell_file_id || '',
        comparison_eligible: comparison?.comparison_eligible ?? ki.comparison_eligible ?? null,
        uncertainty_level: comparison?.uncertainty_level || ki.uncertainty_level || null,
        comparison_reasons: comparison?.comparison_reasons || comparison?.reasons || ki.comparison_reasons || [],
        needs_human_review: comparison?.needs_human_review ?? ki.needs_human_review ?? null,
        lightening_internal_pct: comparison?.lightening_internal_pct ?? ki.lightening_internal_pct ?? null,
        lightening_score: comparison?.lightening_score ?? ki.lightening_score ?? null,
        percent_estimate: comparison?.percent_estimate ?? ki.percent_estimate ?? null,
        progress_direction: comparison?.progress_direction || ki.progress_direction || null,
        lightening_confidence: comparison?.confidence || ki.lightening_confidence || null,
        lightening_factors: comparison?.factors || ki.lightening_factors || null,
        lightening_note_key: comparison?.customer_message || null,
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

    const previous = await resolvePreviousTreatment(sessionDoc);
    const vorherId = req.body.foto_vorher_file_id || previous.photoId;
    if (!vorherId) {
        throw new ApiError(400, FIRST_SESSION_AI_MESSAGE);
    }

    if (req.body.image_quality_ok != null) sessionDoc.image_quality_ok = req.body.image_quality_ok;
    if (req.body.photo_same_angle != null) sessionDoc.photo_same_angle = req.body.photo_same_angle;
    if (req.body.photo_same_distance != null) sessionDoc.photo_same_distance = req.body.photo_same_distance;
    if (req.body.photo_comparable_light != null) {
        sessionDoc.photo_comparable_light = req.body.photo_comparable_light;
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

    const assessment = await evaluateAndApplySessionLightening(sessionDoc, caseDoc, {
        previous,
        initial_photo_id: vorherId,
        follow_up_photo_id: aktuellId,
        visual_fade_pct: mapped.verblassung_prozent,
        same_region: true,
    });

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
        comparison_eligible: assessment.comparison_eligible,
        uncertainty_level: assessment.uncertainty_level,
        comparison_reasons: assessment.comparison_reasons,
        needs_human_review: assessment.needs_human_review,
        lightening_internal_pct: assessment.lightening_internal_pct,
        percent_estimate: assessment.percent_estimate,
        lightening_score: assessment.lightening_score,
        progress_direction: assessment.progress_direction,
        lightening_confidence: assessment.confidence,
        lightening_factors: assessment.factors,
    };

    if (persist) {
        sessionDoc.verblassung_ki = kiPayload;
        sessionDoc.verblassung_raw_ai = rawAi;
        if (!sessionDoc.fortschritt_foto_file_id) {
            sessionDoc.fortschritt_foto_file_id = aktuell.fileAsset._id;
        }
        await sessionDoc.save();
        await syncCaseSessionStats(sessionDoc.case);
    }

    const forStudio = isStudio(req.user.role) || isAdmin(req.user.role);

    res.status(200).json({
        success: true,
        message: persist ? 'Verblassungsanalyse gespeichert' : 'Verblassungsanalyse (nicht gespeichert)',
        data: {
            session_id: String(sessionDoc._id),
            case_id: String(sessionDoc.case),
            verblassung_prozent: assessment.customer_progress_visible
                ? assessment.percent_estimate
                : forStudio
                  ? assessment.lightening_internal_pct
                  : null,
            percent_estimate: assessment.percent_estimate,
            lightening_internal_pct: assessment.lightening_internal_pct,
            lightening_score: assessment.lightening_score,
            progress_direction: assessment.progress_direction,
            lightening_confidence: assessment.confidence,
            comparison_eligible: assessment.comparison_eligible,
            uncertainty_level: assessment.uncertainty_level,
            needs_human_review: assessment.needs_human_review,
            comparison_reasons: assessment.comparison_reasons,
            lightening_note_key: assessment.customer_message,
            compared: true,
            foto_vorher_file_id: vorher.id,
            foto_aktuell_file_id: aktuell.id,
            result: forStudio
                ? formatStudioKi(kiPayload, assessment)
                : formatCustomerKi(kiPayload, assessment),
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
