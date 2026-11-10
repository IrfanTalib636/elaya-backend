const {
    normalizeEndpointReactions,
    endpointReactionLegacyText,
    applySessionOutcomeMirrors,
    ENDPOINT_LABELS,
} = require('../utils/sessionOutcomeNormalize');
const {
    createSessionSchema,
    updateSessionSchema,
    ENDPOINT_REACTION_VALUES,
} = require('../validators/sessionValidator');
const { FILE_PURPOSE } = require('../config/storageConfig');
const Session = require('../models/sessionModel');

let passed = 0;
let failed = 0;

const check = (ok, label, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`PASS  ${label}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const runNormalize = () => {
    console.log('\n=== Unit: normalizeEndpointReactions ===');

    check(
        deepEqual(normalizeEndpointReactions(['frosting', 'redness']), ['frosting', 'redness']),
        'keeps multi-select reactions'
    );
    check(
        deepEqual(normalizeEndpointReactions(['frosting', 'none', 'redness']), ['none']),
        '"none" is exclusive and clears others'
    );
    check(
        deepEqual(normalizeEndpointReactions(['redness', 'redness', 'swelling']), [
            'redness',
            'swelling',
        ]),
        'dedupes reactions'
    );
    check(deepEqual(normalizeEndpointReactions([]), []), 'empty array stays empty');
    check(deepEqual(normalizeEndpointReactions(null), []), 'non-array becomes empty');
    check(deepEqual(normalizeEndpointReactions(['none']), ['none']), 'solo none stays none');
};

const runLegacyText = () => {
    console.log('\n=== Unit: endpointReactionLegacyText ===');

    check(
        endpointReactionLegacyText(['frosting', 'redness']) === 'Frosting, Redness',
        'joins labels with comma'
    );
    check(
        endpointReactionLegacyText(['other'], 'weird wheal') === 'Other: weird wheal',
        'appends other note'
    );
    check(
        endpointReactionLegacyText(['none']) === ENDPOINT_LABELS.none,
        'none uses label'
    );
    check(endpointReactionLegacyText([]) === '', 'empty reactions → empty string');
};

const runMirrors = () => {
    console.log('\n=== Unit: applySessionOutcomeMirrors ===');

    const withChips = applySessionOutcomeMirrors({
        endpoint_reactions: ['frosting', 'none', 'swelling'],
        endpoint_reaction_note: '',
        unusual_immediate_reaction: false,
    });
    check(
        deepEqual(withChips.endpoint_reactions, ['none']),
        'mirror normalizes exclusive none'
    );
    check(
        withChips.endpoint_reaction === ENDPOINT_LABELS.none,
        'mirror writes legacy endpoint_reaction from chips'
    );
    check(withChips.adverse_event_flag === false, 'unusual=false mirrors adverse_event_flag=false');
    check(
        withChips.unusual_reaction_photo_file_id === null,
        'unusual=false clears unusual photo id'
    );
    check(
        withChips.unusual_reaction_treatment_stopped === false,
        'unusual=false clears treatment_stopped'
    );

    const clearedUnusual = applySessionOutcomeMirrors({
        unusual_immediate_reaction: false,
        unusual_reaction_type: 'Stale type',
        unusual_reaction_description: 'Stale desc',
        unusual_reaction_action_taken: 'Stale action',
        unusual_reaction_treatment_stopped: true,
        unusual_reaction_photo_file_id: '507f1f77bcf86cd799439011',
        adverse_event_type: 'Stale adverse',
    });
    check(clearedUnusual.unusual_reaction_type === '', 'unusual=false clears type even if body still has it');
    check(clearedUnusual.unusual_reaction_description === '', 'unusual=false clears description');
    check(clearedUnusual.unusual_reaction_action_taken === '', 'unusual=false clears action');
    check(clearedUnusual.unusual_reaction_treatment_stopped === false, 'unusual=false forces treatment_stopped=false');
    check(clearedUnusual.unusual_reaction_photo_file_id === null, 'unusual=false nulls photo id even if body sent one');
    check(clearedUnusual.adverse_event_type === '', 'unusual=false clears adverse_event_type');

    const withUnusual = applySessionOutcomeMirrors({
        endpoint_reactions: ['other'],
        endpoint_reaction_note: 'petechiae-like spots',
        unusual_immediate_reaction: true,
        unusual_reaction_type: 'Unexpected blistering',
        unusual_reaction_description: 'Small blister at edge',
        unusual_reaction_action_taken: 'Cooling + stop',
        unusual_reaction_treatment_stopped: true,
    });
    check(
        withUnusual.endpoint_reaction === 'Other: petechiae-like spots',
        'other + note → legacy text'
    );
    check(withUnusual.adverse_event_flag === true, 'unusual=true mirrors adverse_event_flag');
    check(
        withUnusual.adverse_event_type === 'Unexpected blistering',
        'adverse_event_type prefers unusual_reaction_type'
    );

    const legacyOnly = applySessionOutcomeMirrors({
        adverse_event_flag: true,
        adverse_event_type: 'Old free-text event',
    });
    check(
        legacyOnly.unusual_immediate_reaction === true,
        'legacy adverse_event_flag backfills unusual_immediate_reaction'
    );
    check(
        legacyOnly.unusual_reaction_type === 'Old free-text event',
        'legacy adverse_event_type backfills unusual_reaction_type'
    );

    const partialUpdate = applySessionOutcomeMirrors({
        cooling_used: true,
    });
    check(
        partialUpdate.unusual_immediate_reaction === undefined,
        'partial update without outcome flags leaves unusual unset'
    );
    check(
        partialUpdate.endpoint_reaction === undefined,
        'partial update without endpoint_reactions leaves legacy unset'
    );
};

const runValidator = () => {
    console.log('\n=== Unit: session validators ===');

    check(
        deepEqual(ENDPOINT_REACTION_VALUES, [
            'frosting',
            'redness',
            'swelling',
            'pinpoint_bleeding',
            'none',
            'other',
        ]),
        'ENDPOINT_REACTION_VALUES match plan keys'
    );

    const base = {
        case_id: '507f1f77bcf86cd799439011',
        treatment_date: '2026-11-08',
        endpoint_reactions: ['frosting', 'redness'],
        endpoint_reaction_note: '',
        unusual_immediate_reaction: true,
        unusual_reaction_type: 'Edema',
        unusual_reaction_description: 'Marked swelling',
        unusual_reaction_action_taken: 'Ice pack',
        unusual_reaction_treatment_stopped: false,
    };

    const created = createSessionSchema.safeParse(base);
    check(created.success, 'createSessionSchema accepts structured outcome');
    if (created.success) {
        check(
            deepEqual(created.data.endpoint_reactions, ['frosting', 'redness']),
            'create keeps endpoint_reactions'
        );
        check(
            created.data.unusual_immediate_reaction === true,
            'create keeps unusual_immediate_reaction'
        );
    }

    const invalidChip = createSessionSchema.safeParse({
        ...base,
        endpoint_reactions: ['frosting', 'blistering'],
    });
    check(!invalidChip.success, 'create rejects unknown reaction key');

    const updated = updateSessionSchema.safeParse({
        endpoint_reactions: ['none'],
        unusual_immediate_reaction: false,
    });
    check(updated.success, 'updateSessionSchema accepts outcome-only patch');

    const stillAllowsFade = updateSessionSchema.safeParse({
        verblassung_prozent: 40,
        removal_pct: 35,
        pain_score_0_10: 3,
    });
    check(
        stillAllowsFade.success,
        'update still accepts legacy fade/removal/pain for AI/compat writes'
    );

    const emptyUpdate = updateSessionSchema.safeParse({});
    check(!emptyUpdate.success, 'update rejects empty body');
};

const runModelAndPurpose = () => {
    console.log('\n=== Unit: model paths + file purpose ===');

    const paths = Session.schema.paths;
    for (const key of [
        'endpoint_reactions',
        'endpoint_reaction_note',
        'unusual_immediate_reaction',
        'unusual_reaction_type',
        'unusual_reaction_description',
        'unusual_reaction_photo_file_id',
        'unusual_reaction_action_taken',
        'unusual_reaction_treatment_stopped',
        'endpoint_reaction',
        'adverse_event_flag',
        'adverse_event_type',
        'verblassung_prozent',
        'removal_pct',
        'pain_score_0_10',
    ]) {
        check(!!paths[key], `Session schema has ${key}`);
    }

    check(
        FILE_PURPOSE.SESSION_UNUSUAL_REACTION === 'session_unusual_reaction',
        'FILE_PURPOSE.SESSION_UNUSUAL_REACTION registered'
    );
    check(
        FILE_PURPOSE.SESSION_PROGRESS === 'session_progress',
        'progress purpose unchanged (pre-treatment / AI)'
    );
    check(
        FILE_PURPOSE.SESSION_POST_TREATMENT === 'session_post_treatment',
        'SESSION_POST_TREATMENT registered (reaction docs only)'
    );
    check(
        !!paths.post_treatment_foto_file_id,
        'Session schema has post_treatment_foto_file_id'
    );
};

const main = () => {
    console.log('verifySessionOutcome — structured treatment result');
    runNormalize();
    runLegacyText();
    runMirrors();
    runValidator();
    runModelAndPurpose();

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
};

main();
