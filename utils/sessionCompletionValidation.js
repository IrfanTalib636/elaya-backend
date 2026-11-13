const isFilled = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return !Number.isNaN(value);
    return true;
};

const entryComplete = (entry) =>
    isFilled(entry?.wavelength_nm) &&
    entry?.fluence_j_cm2 != null &&
    entry?.fluence_j_cm2 !== '' &&
    !Number.isNaN(Number(entry.fluence_j_cm2)) &&
    entry?.spot_size_mm != null &&
    entry?.spot_size_mm !== '' &&
    !Number.isNaN(Number(entry.spot_size_mm)) &&
    entry?.frequency_hz != null &&
    entry?.frequency_hz !== '' &&
    !Number.isNaN(Number(entry.frequency_hz)) &&
    entry?.pass_count != null &&
    entry?.pass_count !== '' &&
    !Number.isNaN(Number(entry.pass_count));

const validateSessionCompletion = (sessionLike, options = {}) => {
    const requirePrePhoto = options.requirePrePhoto !== false;
    const errors = [];
    const s = sessionLike || {};

    if (s.is_no_show) {
        if (!s.treatment_date) errors.push('treatment_date is required');
        return errors;
    }

    if (!s.treatment_date) errors.push('treatment_date is required');
    if (!isFilled(s.mitarbeiter_id) && !isFilled(s.mitarbeiter_name)) {
        errors.push('Treatment performed by (staff) is required');
    }
    if (s.dauer_minuten == null || s.dauer_minuten === '' || Number(s.dauer_minuten) < 0) {
        errors.push('Duration (min) is required');
    }

    if (!isFilled(s.laser_device_id) && !isFilled(s.laser_id)) {
        errors.push('Laser is required');
    }

    const entries = Array.isArray(s.wavelength_entries) ? s.wavelength_entries : [];
    if (!entries.length) {
        errors.push('At least one wavelength parameter set is required');
    } else {
        entries.forEach((entry, index) => {
            if (!entryComplete(entry)) {
                errors.push(
                    `Wavelength ${index + 1}: wavelength, fluence, spot size, frequency and passes are required`
                );
            }
        });
    }

    if (s.cooling_used !== true && s.cooling_used !== false) {
        errors.push('Cooling used must be explicitly set to Yes or No');
    }

    const reactions = Array.isArray(s.endpoint_reactions) ? s.endpoint_reactions : [];
    if (!reactions.length) {
        errors.push('Immediate skin reaction / treatment endpoint is required');
    }
    if (reactions.includes('other') && !isFilled(s.endpoint_reaction_note)) {
        errors.push('Please describe the other endpoint reaction');
    }

    if (s.unusual_immediate_reaction) {
        if (!isFilled(s.unusual_reaction_type)) {
            errors.push('Unusual reaction type is required');
        }
        if (!isFilled(s.unusual_reaction_description)) {
            errors.push('Unusual reaction description is required');
        }
        if (!isFilled(s.unusual_reaction_action_taken)) {
            errors.push('Action taken for unusual reaction is required');
        }
    }

    if (requirePrePhoto) {
        const skipped = !!s.pre_photo_unavailable;
        const hasPhoto = !!(s.fortschritt_foto_file_id || s.fortschritt_foto_data);
        if (!skipped && !hasPhoto) {
            errors.push(
                'Pre-treatment photo is required (or mark “Photo cannot be taken” with a reason)'
            );
        }
        if (skipped && !isFilled(s.pre_photo_unavailable_reason)) {
            errors.push('A reason is required when the pre-treatment photo cannot be taken');
        }
    }

    return errors;
};

module.exports = {
    validateSessionCompletion,
    entryComplete,
};
