const fs = require('fs');
const path = require('path');
const {
    validateSessionCompletion,
    entryComplete,
} = require('../utils/sessionCompletionValidation');
const { inferLaserType } = require('../config/laserCatalogDefaults');
const { formatLaserDevice } = require('../utils/laserCatalogService');
const Session = require('../models/sessionModel');
const {
    createSessionSchema,
    updateSessionSchema,
} = require('../validators/sessionValidator');

const frontendRoot = path.join(__dirname, '../../elaya-frontend');
const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

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

const completeBase = (overrides = {}) => ({
    treatment_date: '2026-11-13',
    mitarbeiter_id: 'staff-1',
    dauer_minuten: 45,
    laser_device_id: 'laser-1',
    wavelength_entries: [
        {
            wavelength_nm: 595,
            fluence_j_cm2: 3.5,
            spot_size_mm: 6,
            frequency_hz: 2,
            pass_count: 3,
        },
    ],
    cooling_used: true,
    endpoint_reactions: ['frosting'],
    fortschritt_foto_file_id: '507f1f77bcf86cd799439011',
    pre_photo_unavailable: false,
    ...overrides,
});

const runEntryComplete = () => {
    console.log('\n=== Unit: entryComplete ===');
    check(
        entryComplete({
            wavelength_nm: 595,
            fluence_j_cm2: 3.5,
            spot_size_mm: 6,
            frequency_hz: 2,
            pass_count: 3,
        }),
        'complete wavelength entry passes'
    );
    check(
        !entryComplete({
            wavelength_nm: 595,
            fluence_j_cm2: '',
            spot_size_mm: 6,
            frequency_hz: 2,
            pass_count: 3,
        }),
        'empty fluence fails'
    );
    check(
        !entryComplete({
            wavelength_nm: '',
            fluence_j_cm2: 3.5,
            spot_size_mm: 6,
            frequency_hz: 2,
            pass_count: 3,
        }),
        'empty wavelength fails'
    );
    check(
        !entryComplete({
            wavelength_nm: 595,
            fluence_j_cm2: 3.5,
            spot_size_mm: 6,
            frequency_hz: 2,
            pass_count: null,
        }),
        'null passes fails'
    );
};

const runCompletionRules = () => {
    console.log('\n=== Unit: validateSessionCompletion ===');

    check(
        validateSessionCompletion(completeBase()).length === 0,
        'fully complete session has no errors'
    );

    const missingLaser = validateSessionCompletion(
        completeBase({ laser_device_id: '', laser_id: '' })
    );
    check(
        missingLaser.some((e) => /laser/i.test(e)),
        'missing laser is rejected'
    );

    const missingWl = validateSessionCompletion(completeBase({ wavelength_entries: [] }));
    check(
        missingWl.some((e) => /wavelength/i.test(e)),
        'empty wavelength_entries rejected'
    );

    const incompleteWl = validateSessionCompletion(
        completeBase({
            wavelength_entries: [
                {
                    wavelength_nm: 595,
                    fluence_j_cm2: null,
                    spot_size_mm: 6,
                    frequency_hz: 2,
                    pass_count: 3,
                },
            ],
        })
    );
    check(
        incompleteWl.some((e) => /fluence|wavelength 1/i.test(e)),
        'incomplete wavelength row rejected'
    );

    const coolingUnset = validateSessionCompletion(completeBase({ cooling_used: null }));
    check(
        coolingUnset.some((e) => /cooling/i.test(e)),
        'cooling_used null rejected (must be Yes or No)'
    );

    check(
        validateSessionCompletion(completeBase({ cooling_used: false })).length === 0,
        'cooling_used false (No) is allowed'
    );

    const noEndpoint = validateSessionCompletion(completeBase({ endpoint_reactions: [] }));
    check(
        noEndpoint.some((e) => /endpoint|reaction/i.test(e)),
        'empty endpoint_reactions rejected'
    );

    const otherNoNote = validateSessionCompletion(
        completeBase({
            endpoint_reactions: ['other'],
            endpoint_reaction_note: '',
        })
    );
    check(
        otherNoNote.some((e) => /other/i.test(e)),
        'endpoint other without note rejected'
    );

    const unusualIncomplete = validateSessionCompletion(
        completeBase({
            unusual_immediate_reaction: true,
            unusual_reaction_type: '',
            unusual_reaction_description: 'x',
            unusual_reaction_action_taken: 'y',
        })
    );
    check(
        unusualIncomplete.some((e) => /unusual reaction type/i.test(e)),
        'unusual reaction without type rejected'
    );

    const noPhoto = validateSessionCompletion(
        completeBase({
            fortschritt_foto_file_id: null,
            fortschritt_foto_data: null,
            pre_photo_unavailable: false,
        })
    );
    check(
        noPhoto.some((e) => /pre-treatment photo/i.test(e)),
        'missing pre-photo rejected'
    );

    const skipNoReason = validateSessionCompletion(
        completeBase({
            fortschritt_foto_file_id: null,
            pre_photo_unavailable: true,
            pre_photo_unavailable_reason: '',
        })
    );
    check(
        skipNoReason.some((e) => /reason/i.test(e)),
        'photo skip without reason rejected'
    );

    const skipOk = validateSessionCompletion(
        completeBase({
            fortschritt_foto_file_id: null,
            pre_photo_unavailable: true,
            pre_photo_unavailable_reason: 'Client declined photo',
        })
    );
    check(skipOk.length === 0, 'photo skip with reason allows completion');

    const noShow = validateSessionCompletion({
        is_no_show: true,
        treatment_date: '2026-11-13',
    });
    check(noShow.length === 0, 'no-show only requires treatment_date');

    const noShowNoDate = validateSessionCompletion({ is_no_show: true });
    check(
        noShowNoDate.some((e) => /treatment_date/i.test(e)),
        'no-show without date rejected'
    );

    const draftPhotoOptional = validateSessionCompletion(
        completeBase({
            fortschritt_foto_file_id: null,
        }),
        { requirePrePhoto: false }
    );
    check(
        !draftPhotoOptional.some((e) => /pre-treatment photo/i.test(e)),
        'requirePrePhoto:false skips photo check (draft path)'
    );

    const staffByName = validateSessionCompletion(
        completeBase({ mitarbeiter_id: '', mitarbeiter_name: 'Ada Lovelace' })
    );
    check(staffByName.length === 0, 'staff via mitarbeiter_name alone is enough');
};

const runLaserType = () => {
    console.log('\n=== Unit: inferLaserType / formatLaserDevice ===');

    check(
        inferLaserType('Lutronic', 'PicoPlus') === 'Picosecond',
        'Lutronic PicoPlus → Picosecond'
    );
    check(
        inferLaserType('Candela', 'PicoWay') === 'Picosecond',
        'Candela PicoWay → Picosecond'
    );
    check(
        inferLaserType('Fotona', 'StarWalker') === 'Q-switched / Picosecond',
        'Fotona StarWalker → Q-switched / Picosecond'
    );
    check(
        inferLaserType('Acme', 'MegaPico X') === 'Picosecond',
        'name containing pico infers Picosecond'
    );

    const formatted = formatLaserDevice({
        _id: '507f1f77bcf86cd799439099',
        manufacturer: 'Lutronic',
        model: 'PicoPlus',
        laser_type: '',
        wavelengths_nm: [532, 595, 660, 1064],
        active: true,
        notes: '',
    });
    check(
        formatted.laser_type === 'Picosecond',
        'formatLaserDevice fills empty laser_type from catalog defaults'
    );
    check(
        formatLaserDevice({
            _id: '507f1f77bcf86cd799439098',
            manufacturer: 'Lutronic',
            model: 'PicoPlus',
            laser_type: 'Custom Type',
            wavelengths_nm: [1064],
            active: true,
        }).laser_type === 'Custom Type',
        'formatLaserDevice keeps explicit laser_type'
    );
};

const runModelAndValidators = () => {
    console.log('\n=== Unit: model + zod fields ===');

    const paths = Session.schema.paths;
    for (const key of [
        'pre_photo_unavailable',
        'pre_photo_unavailable_reason',
        'cooling_used',
        'laser_device_id',
        'laser_typ',
        'wavelength_entries',
        'fortschritt_foto_file_id',
    ]) {
        check(!!paths[key], `Session schema has ${key}`);
    }

    const created = createSessionSchema.safeParse({
        case_id: '507f1f77bcf86cd799439011',
        treatment_date: '2026-11-13',
        cooling_used: null,
        pre_photo_unavailable: true,
        pre_photo_unavailable_reason: 'Pain / swelling',
        wavelength_entries: [
            {
                wavelength_nm: 1064,
                fluence_j_cm2: 1.2,
                spot_size_mm: 4,
                frequency_hz: 1,
                pass_count: 2,
            },
        ],
    });
    check(created.success, 'createSessionSchema accepts photo-skip + wavelength_entries');
    if (created.success) {
        check(created.data.pre_photo_unavailable === true, 'create keeps pre_photo_unavailable');
        check(
            created.data.pre_photo_unavailable_reason === 'Pain / swelling',
            'create keeps skip reason'
        );
        check(created.data.cooling_used === null, 'create allows cooling_used null on draft body');
    }

    const updated = updateSessionSchema.safeParse({
        is_draft: false,
        cooling_used: false,
        pre_photo_unavailable: false,
    });
    check(updated.success, 'updateSessionSchema accepts finalize + cooling No');
};

const runSourceWiring = () => {
    console.log('\n=== Wiring: controller + frontend ===');

    const sessionController = readIfExists(
        path.join(__dirname, '../controllers/sessionController.js')
    );
    const verblassung = readIfExists(
        path.join(__dirname, '../controllers/verblassungController.js')
    );
    const catalogService = readIfExists(path.join(__dirname, '../utils/laserCatalogService.js'));
    const newSession = readIfExists(path.join(frontendRoot, 'src/pages/studio/NewSession.jsx'));
    const sessionDetail = readIfExists(
        path.join(frontendRoot, 'src/pages/studio/SessionDetail.jsx')
    );
    const feValidation = readIfExists(
        path.join(frontendRoot, 'src/utils/sessionCompletionValidation.js')
    );
    const enI18n = readIfExists(path.join(frontendRoot, 'src/i18n/locales/en.ts'));
    const deI18n = readIfExists(path.join(frontendRoot, 'src/i18n/locales/de.ts'));

    check(
        sessionController.includes('validateSessionCompletion'),
        'sessionController uses validateSessionCompletion'
    );
    check(
        /requirePrePhoto:\s*true/.test(sessionController),
        'sessionController enforces requirePrePhoto on completion'
    );
    check(
        sessionController.includes('pre_photo_unavailable'),
        'sessionController respects pre_photo_unavailable'
    );
    check(
        /hasOwnProperty\.call\(fields,\s*'laser_device_id'\)/.test(sessionController),
        'partial update does not wipe laser_device_id when omitted'
    );
    check(
        verblassung.includes('pre_photo_unavailable'),
        'verblassungController blocks AI when photo unavailable'
    );
    check(
        catalogService.includes('backfillMissingLaserTypes'),
        'laser catalog backfills missing laser_type'
    );
    check(
        catalogService.includes('inferLaserType'),
        'laser catalog formats with inferLaserType'
    );

    check(
        feValidation.includes('validateSessionFormForCompletion') &&
            feValidation.includes('cooling_used') &&
            feValidation.includes('pre_photo_unavailable'),
        'frontend sessionCompletionValidation present'
    );
    check(
        newSession.includes('validateSessionFormForCompletion'),
        'NewSession runs client completion validation'
    );
    check(
        newSession.includes('pre_photo_unavailable') &&
            newSession.includes('prePhotoUnavailable'),
        'NewSession has photo-cannot-be-taken UI'
    );
    check(
        /cooling_used === true/.test(newSession) && /cooling_used === false/.test(newSession),
        'NewSession cooling uses explicit Yes/No selection'
    );
    check(
        sessionDetail.includes('validateSessionFormForCompletion'),
        'SessionDetail finalize validates completion'
    );
    check(
        sessionDetail.includes('pre_photo_unavailable'),
        'SessionDetail shows/stores photo-skip in history'
    );

    check(
        enI18n.includes('prePhotoUnavailable') && deI18n.includes('prePhotoUnavailable'),
        'EN/DE i18n for photo cannot be taken'
    );
    check(
        enI18n.includes('coolingRequired') && deI18n.includes('coolingRequired'),
        'EN/DE i18n for cooling required'
    );
};

const main = () => {
    console.log('verifySessionCompletionValidation — required session documentation');
    runEntryComplete();
    runCompletionRules();
    runLaserType();
    runModelAndValidators();
    runSourceWiring();

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
};

main();
