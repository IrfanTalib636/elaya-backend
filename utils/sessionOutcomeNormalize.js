const ENDPOINT_LABELS = {
    frosting: 'Frosting',
    redness: 'Redness',
    swelling: 'Swelling / edema',
    pinpoint_bleeding: 'Pinpoint bleeding / purpura',
    none: 'No unusual reaction',
    other: 'Other',
};

const normalizeEndpointReactions = (raw = []) => {
    const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
    if (list.includes('none')) return ['none'];
    return [...new Set(list.filter((v) => v !== 'none'))];
};

const endpointReactionLegacyText = (reactions = [], note = '') => {
    const list = normalizeEndpointReactions(reactions);
    if (!list.length) return '';
    const labels = list.map((key) => ENDPOINT_LABELS[key] || key);
    if (list.includes('other') && note) {
        return `${labels.join(', ')}: ${note}`;
    }
    return labels.join(', ');
};

/**
 * Mutates a plain fields object (validated create/update body) so structured
 * and legacy outcome fields stay consistent.
 */
const applySessionOutcomeMirrors = (fields = {}) => {
    const next = { ...fields };

    if (Array.isArray(next.endpoint_reactions)) {
        next.endpoint_reactions = normalizeEndpointReactions(next.endpoint_reactions);
        next.endpoint_reaction = endpointReactionLegacyText(
            next.endpoint_reactions,
            next.endpoint_reaction_note || ''
        );
    }

    if (typeof next.unusual_immediate_reaction === 'boolean') {
        next.adverse_event_flag = next.unusual_immediate_reaction;
        if (next.unusual_immediate_reaction) {
            next.adverse_event_type =
                next.unusual_reaction_type ||
                next.unusual_reaction_description ||
                next.adverse_event_type ||
                '';
        } else {
            // Clearing Yes → No must wipe detail fields so partial updates
            // cannot leave stale type/description/photo on the session.
            next.adverse_event_type = '';
            next.unusual_reaction_type = '';
            next.unusual_reaction_description = '';
            next.unusual_reaction_action_taken = '';
            next.unusual_reaction_treatment_stopped = false;
            next.unusual_reaction_photo_file_id = null;
        }
    } else if (typeof next.adverse_event_flag === 'boolean' && next.unusual_immediate_reaction === undefined) {
        // Legacy clients still posting adverse_event_flag only.
        next.unusual_immediate_reaction = next.adverse_event_flag;
        if (next.adverse_event_flag && !next.unusual_reaction_type) {
            next.unusual_reaction_type = next.adverse_event_type || '';
        }
    }

    if (
        next.unusual_reaction_photo_file_id === '' ||
        next.unusual_reaction_photo_file_id === undefined
    ) {
        // leave unset on partial updates; create path defaults to null in model
    }
    if (next.unusual_reaction_photo_file_id === null) {
        next.unusual_reaction_photo_file_id = null;
    }

    return next;
};

module.exports = {
    ENDPOINT_LABELS,
    normalizeEndpointReactions,
    endpointReactionLegacyText,
    applySessionOutcomeMirrors,
};
