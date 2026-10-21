/**
 * Case display IDs are stored with a leading `#` (e.g. `#TRI-001`).
 * Use this when embedding them in user-facing copy so we never emit `##TRI-001`.
 */
const formatCaseRef = (caseId) => {
    const raw = String(caseId || '').trim();
    if (!raw) return '';
    return raw.startsWith('#') ? raw : `#${raw}`;
};

/** e.g. "Case #TRI-001" */
const formatCaseLabel = (caseId) => {
    const ref = formatCaseRef(caseId);
    return ref ? `Case ${ref}` : 'Tattoo Case';
};

module.exports = {
    formatCaseRef,
    formatCaseLabel,
};
