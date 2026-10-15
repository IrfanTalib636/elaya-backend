/**
 * Laser colour deltas have one source of truth (session_prediction.laser_color_overrides):
 * Laser profile edit → shared DRAFT → Engine preview uses it → LIVE unchanged until publish.
 * Restores the platform draft state afterwards.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const PlatformConfig = require('../models/platformConfigModel');
const { listLaserDevices, saveLaserColorDraft, getLaserDeviceById } = require('../utils/laserCatalogService');
const { getConfigLifecycle, getPlatformConfig } = require('../utils/configService');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { previewSessionPrediction } = require('../utils/sessionPredictionEngine');

const check = (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) process.exitCode = 1;
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const before = await PlatformConfig.findOne({ key: 'platform' }).lean();
    const savedDraft = before?.drafts?.session_prediction;

    try {
        const devices = await listLaserDevices();
        const laser = devices.find((d) => /picoplus/i.test(d.model)) || devices[0];
        check(Boolean(laser?.color_deltas), `laser profile exposes LIVE colours (${laser?.label})`);

        const live = await getPlatformConfig();
        const liveMap = live.session_prediction.laser_color_overrides[laser.id] || {};
        const platformGreen = live.session_prediction.tattoo_deltas.color.green;
        check(
            laser.color_deltas.green === (liveMap.green ?? platformGreen),
            `laser profile LIVE green (${laser.color_deltas.green}) = override or platform default (${liveMap.green ?? platformGreen})`
        );

        const startGreen = (laser.color_deltas_draft || laser.color_deltas).green;
        const target = startGreen + 1;
        await saveLaserColorDraft(laser.id, { ...(laser.color_deltas_draft || laser.color_deltas), green: target });

        const after = await getLaserDeviceById(laser.id);
        check(after.color_deltas.green === laser.color_deltas.green, 'LIVE green unchanged after laser-profile edit');
        check(after.color_deltas_draft?.green === target, `laser profile shows DRAFT green ${target}`);

        const lifecycle = await getConfigLifecycle('session_prediction');
        const engineDraft = lifecycle.draft?.data?.laser_color_overrides?.[laser.id];
        check(engineDraft?.green === target, 'Prediction Engine draft holds the same green value');
        check(
            (lifecycle.published.laser_color_overrides[laser.id]?.green ?? platformGreen) ===
                laser.color_deltas.green,
            'Prediction Engine LIVE still holds the published green value'
        );

        const caseInput = {
            type: 'tattoo',
            flaeche_cm2: 40,
            skin_fitzpatrick_type: 'III',
            tc_body_location_main: 'arm',
            tc_colors_present: ['black', 'green'],
            laser_device_id: laser.id,
        };
        const preview = previewSessionPrediction(
            caseInput,
            mergeSessionPrediction(lifecycle.draft.data),
            { baselinePrediction: lifecycle.published }
        );
        check(
            preview.delta.tattoo_delta === target - laser.color_deltas.green,
            `impact preview: DRAFT tattoo delta ${preview.live.tattoo_delta} vs LIVE ${preview.baseline.tattoo_delta}`
        );
    } finally {
        const restore = savedDraft
            ? { $set: { 'drafts.session_prediction': savedDraft } }
            : { $unset: { 'drafts.session_prediction': 1 } };
        await PlatformConfig.updateOne({ key: 'platform' }, restore);
        console.log('Restored original session_prediction draft state.');
        await mongoose.disconnect();
    }
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
