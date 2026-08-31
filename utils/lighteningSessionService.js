/**
 * Load previous treatment photo + run §8 lightening logic onto a session doc.
 */

const Session = require('../models/sessionModel');
const CaseZone = require('../models/caseZoneModel');
const FileAsset = require('../models/fileAssetModel');
const { FILE_PURPOSE, FILE_STATUS } = require('../config/storageConfig');
const {
    computeComparisonEligible,
    daysBetween,
} = require('./lighteningComparisonEngine');
const {
    computeLighteningAssessment,
    applyLighteningToSession,
} = require('./lighteningLogicEngine');

const isObjectId = (value) =>
    typeof value === 'string' && require('mongoose').Types.ObjectId.isValid(value);

const resolveProgressFileIdForSession = async (sessionDoc) => {
    if (!sessionDoc) return null;
    if (sessionDoc.fortschritt_foto_file_id) {
        return String(sessionDoc.fortschritt_foto_file_id);
    }
    if (isObjectId(sessionDoc.fortschritt_foto_data)) {
        return sessionDoc.fortschritt_foto_data;
    }
    if (!sessionDoc._id) return null;
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

/**
 * The treatment this one is compared against.
 *
 * Scoped to the session's zone: comparing a zone against a different zone's
 * photo would measure two unrelated areas. Session numbering is per zone, so
 * "the previous session" is unambiguous within a zone.
 */
const resolvePreviousTreatment = async (sessionDoc) => {
    const prev = await Session.findOne({
        case: sessionDoc.case,
        zonen_id: sessionDoc.zonen_id ?? null,
        _id: { $ne: sessionDoc._id },
        session_number: { $lt: sessionDoc.session_number },
        is_no_show: false,
        is_draft: false,
    })
        .sort({ session_number: -1 })
        .lean();

    if (!prev) return { photoId: null, treatmentDate: null, percent: null };
    return {
        photoId: await resolveProgressFileIdForSession(prev),
        treatmentDate: prev.treatment_date || null,
        percent:
            prev.comparison_eligible === false
                ? null
                : prev.verblassung_prozent ?? prev.removal_pct ?? null,
    };
};

const loadSessionZone = async (sessionDoc) => {
    if (!sessionDoc?.zonen_id) return null;
    return CaseZone.findOne({
        case: sessionDoc.case,
        zonen_id: sessionDoc.zonen_id,
    })
        .select('foto_url farben dichte')
        .lean();
};

/**
 * Baseline photo for a zone: its intake shot, which the customer was asked to
 * frame identically for exactly this comparison.
 */
const resolveZoneBaselinePhotoId = async (sessionDoc) => {
    const zone = await loadSessionZone(sessionDoc);
    return zone?.foto_url || null;
};

const evaluateAndApplySessionLightening = async (sessionDoc, caseDoc, extras = {}) => {
    if (!sessionDoc || sessionDoc.is_no_show) return null;

    const previous = extras.previous || (await resolvePreviousTreatment(sessionDoc));
    const zone = await loadSessionZone(sessionDoc);
    const followUpId =
        extras.follow_up_photo_id || (await resolveProgressFileIdForSession(sessionDoc));
    // For a zone, fall back to that zone's intake photo rather than the
    // case-level one, which shows the whole tattoo and is not comparable.
    const initialId =
        extras.initial_photo_id ||
        previous.photoId ||
        zone?.foto_url ||
        (sessionDoc.zonen_id ? null : caseDoc?.photo_intake_main) ||
        null;

    const days_since_previous =
        extras.days_since_previous != null
            ? extras.days_since_previous
            : daysBetween(previous.treatmentDate, sessionDoc.treatment_date || new Date());

    const comparison = computeComparisonEligible({
        has_initial_photo: Boolean(initialId),
        has_follow_up_photo: Boolean(followUpId),
        same_region: extras.same_region !== false,
        photo_std_intake: caseDoc?.photo_std_intake,
        image_quality_ok: sessionDoc.image_quality_ok,
        photo_same_angle: sessionDoc.photo_same_angle,
        photo_same_distance: sessionDoc.photo_same_distance,
        photo_comparable_light: sessionDoc.photo_comparable_light,
        days_since_previous,
        coverup_level: caseDoc?.tc_coverup,
    });

    const visual =
        extras.visual_fade_pct != null
            ? extras.visual_fade_pct
            : sessionDoc.lightening_studio_pct != null
              ? sessionDoc.lightening_studio_pct
              : extras.keep_visual === false
                ? null
                : sessionDoc.lightening_internal_pct ?? sessionDoc.verblassung_prozent ?? sessionDoc.removal_pct;

    const assessment = computeLighteningAssessment({
        comparison,
        visual_fade_pct: visual,
        previous_percent: extras.previous_percent ?? previous.percent ?? caseDoc?.removal,
        studio_review_pct: sessionDoc.lightening_studio_pct,
        // Colours and density are measured per zone; saturation, coverup and
        // lifestyle only exist at case level.
        colors: zone?.farben?.length ? zone.farben : caseDoc?.tc_colors_present,
        density: zone?.dichte || caseDoc?.tc_density,
        saturation: caseDoc?.tc_saturation,
        coverup: caseDoc?.tc_coverup,
        laser_profile_level: extras.laser_profile_level || caseDoc?.laser_profile_level,
        smoker: caseDoc?.life_smoker,
        sleep_quality: extras.sleep_quality || caseDoc?.life_sleep_quality,
        stress_level: extras.stress_level || caseDoc?.life_stress,
        days_since_previous,
        sessions_done: Math.max(0, Number(sessionDoc.session_number) - 1),
        progress_direction_self: extras.progress_direction_self,
    });

    applyLighteningToSession(sessionDoc, assessment);
    return assessment;
};

module.exports = {
    evaluateAndApplySessionLightening,
    resolvePreviousTreatment,
    resolveProgressFileIdForSession,
    resolveZoneBaselinePhotoId,
};
