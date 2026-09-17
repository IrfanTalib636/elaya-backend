const LASER_CATALOG_DEFAULTS = [
    {
        manufacturer: 'Candela',
        model: 'PicoWay',
        wavelengths_nm: [532, 785, 1064],
        notes: 'Picosecond platform',
        active: true,
    },
    {
        manufacturer: 'Cynosure',
        model: 'PicoSure',
        wavelengths_nm: [532, 755, 1064],
        notes: 'Alexandrite + Nd:YAG picosecond',
        active: true,
    },
    {
        manufacturer: 'Fotona',
        model: 'StarWalker',
        wavelengths_nm: [532, 1064],
        notes: 'Q-switched / pico hybrid',
        active: true,
    },
    {
        manufacturer: 'Lutronic',
        model: 'PicoPlus',
        wavelengths_nm: [532, 595, 660, 1064],
        notes: 'Multi-wavelength picosecond',
        active: true,
    },
];

module.exports = {
    LASER_CATALOG_DEFAULTS,
};
