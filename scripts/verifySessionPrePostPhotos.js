const fs = require('fs');
const path = require('path');
const { FILE_PURPOSE } = require('../config/storageConfig');
const Session = require('../models/sessionModel');
const {
    createSessionSchema,
    updateSessionSchema,
} = require('../validators/sessionValidator');
const {
    sessionProgressPath,
    sessionPostTreatmentPath,
} = require('../services/fileStorageService');
const lighteningSrc = fs.readFileSync(
    path.join(__dirname, '../utils/lighteningSessionService.js'),
    'utf8'
);
const verblassungSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/verblassungController.js'),
    'utf8'
);
const fileControllerSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/fileController.js'),
    'utf8'
);
const forecastSrc = fs.readFileSync(
    path.join(__dirname, '../utils/sessionForecastFromProgress.js'),
    'utf8'
);
const sessionControllerSrc = fs.readFileSync(
    path.join(__dirname, '../controllers/sessionController.js'),
    'utf8'
);
const fileRouteSrc = fs.readFileSync(
    path.join(__dirname, '../routes/fileRoute.js'),
    'utf8'
);
const frontendRoot = path.join(__dirname, '../../elaya-frontend');
const mobileRoot = path.join(__dirname, '../../elaya-mobile');
const webRoot = path.join(__dirname, '../../elaya-web');
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

const studioId = '507f1f77bcf86cd799439011';
const sessionId = '507f1f77bcf86cd799439012';

console.log('verifySessionPrePostPhotos — pre (AI) vs post (reaction)\n');

console.log('=== Purpose + model ===');
check(
    FILE_PURPOSE.SESSION_PROGRESS === 'session_progress',
    'SESSION_PROGRESS purpose unchanged'
);
check(
    FILE_PURPOSE.SESSION_POST_TREATMENT === 'session_post_treatment',
    'SESSION_POST_TREATMENT purpose registered'
);
check(
    !!Session.schema.paths.fortschritt_foto_file_id,
    'Session has fortschritt_foto_file_id (pre / AI)'
);
check(
    !!Session.schema.paths.post_treatment_foto_file_id,
    'Session has post_treatment_foto_file_id (reaction)'
);

console.log('\n=== Storage paths ===');
const progressPath = sessionProgressPath(studioId, sessionId, 'image/jpeg');
const postPath = sessionPostTreatmentPath(studioId, sessionId, 'image/jpeg');
check(progressPath.includes(`${path.sep}progress.jpg`), 'progress path ends with progress.jpg');
check(postPath.includes(`${path.sep}post.jpg`), 'post-treatment path ends with post.jpg');
check(progressPath !== postPath, 'pre and post storage paths differ');

console.log('\n=== AI isolation (source scan) ===');
check(
    lighteningSrc.includes('resolveProgressFileIdForSession'),
    'lightening resolves via resolveProgressFileIdForSession'
);
check(
    lighteningSrc.includes('FILE_PURPOSE.SESSION_PROGRESS'),
    'lightening FileAsset lookup uses SESSION_PROGRESS'
);
check(
    !lighteningSrc.includes('post_treatment_foto_file_id') ||
        lighteningSrc.includes('Never use post_treatment_foto_file_id'),
    'lightening documents that post_treatment must not be used'
);
check(
    !lighteningSrc.includes('SESSION_POST_TREATMENT') ||
        lighteningSrc.includes('Never use post_treatment_foto_file_id'),
    'lightening does not select SESSION_POST_TREATMENT as follow-up'
);
check(
    !/\$\.|findOne\([\s\S]*SESSION_POST_TREATMENT/.test(lighteningSrc),
    'lightening has no FileAsset query for SESSION_POST_TREATMENT'
);
check(
    verblassungSrc.includes('resolveProgressFileIdForSession'),
    'verblassung uses resolveProgressFileIdForSession'
);
check(
    !verblassungSrc.includes('post_treatment_foto_file_id') &&
        !verblassungSrc.includes('SESSION_POST_TREATMENT'),
    'verblassung never references post-treatment field/purpose'
);
check(
    !forecastSrc.includes('post_treatment_foto_file_id') &&
        !forecastSrc.includes('SESSION_POST_TREATMENT'),
    'session forecast never references post-treatment field/purpose'
);

console.log('\n=== Upload handlers ===');
check(
    /uploadSessionProgress[\s\S]*evaluateAndApplySessionLightening/.test(fileControllerSrc),
    'progress upload may trigger lightening'
);
const postHandlerMatch = fileControllerSrc.match(
    /uploadSessionPostTreatment[\s\S]*?uploadSessionUnusualReaction/
);
check(!!postHandlerMatch, 'post-treatment upload handler present');
check(
    postHandlerMatch && !postHandlerMatch[0].includes('evaluateAndApplySessionLightening'),
    'post-treatment upload does not call lightening'
);
check(
    postHandlerMatch && postHandlerMatch[0].includes('post_treatment_foto_file_id'),
    'post-treatment upload sets post_treatment_foto_file_id'
);
check(
    postHandlerMatch && postHandlerMatch[0].includes('FILE_PURPOSE.SESSION_POST_TREATMENT'),
    'post-treatment upload uses SESSION_POST_TREATMENT purpose'
);
check(
    /post-treatment[\s\S]*uploadSessionPostTreatment/.test(fileRouteSrc),
    'fileRoute wires POST …/post-treatment'
);
check(
    /CUSTOMER_SESSION_SELECT[\s\S]*post_treatment_foto_file_id/.test(sessionControllerSrc),
    'customer session select includes post_treatment_foto_file_id'
);
check(
    /post_treatment_foto_file_id:\s*s\.post_treatment_foto_file_id/.test(sessionControllerSrc),
    'formatSession exposes post_treatment_foto_file_id'
);

console.log('\n=== Validators ===');
const created = createSessionSchema.safeParse({
    case_id: '507f1f77bcf86cd799439011',
    treatment_date: '2026-01-01',
    post_treatment_foto_file_id: '507f1f77bcf86cd799439014',
});
check(
    created.success,
    'createSessionSchema accepts post_treatment_foto_file_id',
    created.error ? JSON.stringify(created.error.issues) : ''
);
const updated = updateSessionSchema.safeParse({
    post_treatment_foto_file_id: null,
});
check(
    updated.success,
    'updateSessionSchema accepts nulling post_treatment_foto_file_id',
    updated.error ? JSON.stringify(updated.error.issues) : ''
);

console.log('\n=== Frontend / customer wiring + i18n ===');
const filesApi = readIfExists(path.join(frontendRoot, 'src/api/files.js'));
const newSession = readIfExists(path.join(frontendRoot, 'src/pages/studio/NewSession.jsx'));
const sessionDetail = readIfExists(path.join(frontendRoot, 'src/pages/studio/SessionDetail.jsx'));
const caseDetail = readIfExists(path.join(frontendRoot, 'src/pages/studio/CaseDetail.jsx'));
const enI18n = readIfExists(path.join(frontendRoot, 'src/i18n/locales/en.ts'));
const deI18n = readIfExists(path.join(frontendRoot, 'src/i18n/locales/de.ts'));
const mobileTypes = readIfExists(path.join(mobileRoot, 'src/api/types.ts'));
const webTypes = readIfExists(path.join(webRoot, 'src/lib/api/types.ts'));
const verlauf = readIfExists(path.join(mobileRoot, 'src/screens/app/VerlaufScreen.tsx'));
const care = readIfExists(path.join(webRoot, 'src/features/careScreens.tsx'));

check(filesApi.includes('/post-treatment'), 'studio files API posts to /post-treatment');
check(
    newSession.includes('uploadSessionProgressPhoto') &&
        newSession.includes('uploadSessionPostTreatmentPhoto'),
    'NewSession uploads pre + post'
);
check(
    /runAi\s*=\s*[\s\S]*?preUploaded[\s\S]*?autoAnalyze[\s\S]*?pre_photo_unavailable/.test(
        newSession
    ) ||
        /preUploaded\s*&&\s*autoAnalyze/.test(newSession),
    'NewSession AI analyze gated on preUploaded + autoAnalyze (not post)'
);
check(
    /!form\.pre_photo_unavailable/.test(newSession) &&
        newSession.includes('analyzeVerblassung'),
    'NewSession skips AI when pre-photo unavailable'
);
check(
    !/wantsPostPhoto && autoAnalyze/.test(newSession) &&
        !/wantsPostPhoto[\s\S]{0,80}analyzeVerblassung/.test(newSession),
    'NewSession does not trigger AI from post photo alone'
);
check(
    sessionDetail.includes('PostTreatmentPhotoSection') &&
        sessionDetail.includes('post_treatment_foto_file_id'),
    'SessionDetail renders post-treatment section'
);
check(
    caseDetail.includes('post_treatment_foto_file_id') &&
        /withPhotos[\s\S]*fortschritt_foto_file_id/.test(caseDetail),
    'CaseDetail shows post thumb; fade list still pre-based'
);
check(mobileTypes.includes('post_treatment_foto_file_id'), 'mobile SessionSummary has post field');
check(webTypes.includes('post_treatment_foto_file_id'), 'web SessionSummary has post field');
check(
    /filter\(\(s\) => s\.fortschritt_foto_file_id\)/.test(verlauf) &&
        verlauf.includes('post_treatment_foto_file_id'),
    'mobile Verlauf fade on pre; shows post when present'
);
check(
    /filter\(\(s\) => s\.fortschritt_foto_file_id\)/.test(care) &&
        care.includes('post_treatment_foto_file_id'),
    'web care fade on pre; shows post when present'
);
check(/postPhotoHint[\s\S]{0,100}Not used for AI/.test(enI18n), 'EN postPhotoHint denies AI');
check(/postPhotoHint[\s\S]{0,140}nicht für die KI/.test(deI18n), 'DE postPhotoHint denies AI');
check(enI18n.includes('photoPostReaction') && deI18n.includes('photoPostReaction'), 'studio caseDetail photoPostReaction EN/DE');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
