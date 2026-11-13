const LASER_CATALOG_DEFAULTS = [
    {
        manufacturer: 'Candela',
        model: 'PicoWay',
        laser_type: 'Picosecond',
        wavelengths_nm: [532, 785, 1064],
        notes: 'Picosecond platform',
        active: true,
    },
    {
        manufacturer: 'Cynosure',
        model: 'PicoSure',
        laser_type: 'Picosecond',
        wavelengths_nm: [532, 755, 1064],
        notes: 'Alexandrite + Nd:YAG picosecond',
        active: true,
    },
    {
        manufacturer: 'Fotona',
        model: 'StarWalker',
        laser_type: 'Q-switched / Picosecond',
        wavelengths_nm: [532, 1064],
        notes: 'Q-switched / pico hybrid',
        active: true,
    },
    {
        manufacturer: 'Lutronic',
        model: 'PicoPlus',
        laser_type: 'Picosecond',
        wavelengths_nm: [532, 595, 660, 1064],
        notes: 'Multi-wavelength picosecond',
        active: true,
    },
];

const inferLaserType = (manufacturer, model, notes = '') => {
    const key = `${String(manufacturer || '').trim()}|${String(model || '').trim()}`.toLowerCase();
    const fromDefaults = LASER_CATALOG_DEFAULTS.find(
        (row) =>
            `${row.manufacturer}|${row.model}`.toLowerCase() === key && row.laser_type
    );
    if (fromDefaults?.laser_type) return fromDefaults.laser_type;
    const blob = `${manufacturer || ''} ${model || ''} ${notes || ''}`.toLowerCase();
    if (blob.includes('pico')) return 'Picosecond';
    if (blob.includes('q-switch') || blob.includes('qswitch')) return 'Q-switched';
    if (blob.includes('nd:yag') || blob.includes('ndyag')) return 'Nd:YAG';
    if (blob.includes('alexandrite')) return 'Alexandrite';
    return '';
};

module.exports = {
    LASER_CATALOG_DEFAULTS,
    inferLaserType,
};
