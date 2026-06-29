/**
 * Assigns display IDs in format #XXX-001 (client spec / ensureCaseIds in prototype).
 * XXX = up to 3 letters from case title or bodyLabel.
 */
const generateCaseId = (title, existingCaseIds = []) => {
    const kuerzel =
        (title || 'CAS')
            .toUpperCase()
            .replace(/Ä/g, 'AE')
            .replace(/Ö/g, 'OE')
            .replace(/Ü/g, 'UE')
            .replace(/[^A-Z]/g, '')
            .substring(0, 3) || 'CAS';

    const prefix = `#${kuerzel}-`;
    const numbers = existingCaseIds
        .filter((id) => id && id.startsWith(prefix))
        .map((id) => parseInt(id.split('-')[1], 10) || 0);

    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
};

const resolveCaseIdTitle = (caseDoc) =>
    caseDoc.tc_title || caseDoc.bodyLabel || 'Case';

module.exports = {
    generateCaseId,
    resolveCaseIdTitle,
};
