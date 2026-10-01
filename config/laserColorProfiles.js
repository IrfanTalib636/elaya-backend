const SKIN_TONE = { skin_tone: 3 };

const LASER_COLOR_PROFILES = [
    {
        keys: ['lutronic picoplus', 'lutronicpicoplus'],
        colors: { black: 0, grey: 0, red: 0, orange: 2, blue: 0, green: 3, purple: 0, yellow: 2, white: 3 },
    },
    {
        keys: ['candela picoway', 'candelapicoway'],
        colors: { black: 0, grey: 0, red: 0, orange: 0, blue: 0, green: 0, purple: 0, yellow: 1, white: 3 },
    },
    {
        keys: ['cynosure picosure pro', 'cynosure picosure', 'cynosurepicosure'],
        colors: { black: 0, grey: 0, red: 0, orange: 1, blue: 0, green: 0, purple: 0, yellow: 1, white: 3 },
    },
    {
        keys: ['quanta discovery pico plus', 'quantadiscoverypicoplus'],
        colors: { black: 0, grey: 0, red: 0, orange: 1, blue: 0, green: 0, purple: 1, yellow: 1, white: 3 },
    },
    {
        keys: ['asclepion picostar', 'asclepionpicostar'],
        colors: { black: 0, grey: 0, red: 0, orange: 1, blue: 1, green: 1, purple: 1, yellow: 1, white: 3 },
    },
    {
        keys: ['fotona starwalker', 'fotonastarwalker'],
        colors: { black: 0, grey: 0, red: 0, orange: 0, blue: 0, green: 0, purple: 0, yellow: 2, white: 3 },
    },
];

const normalizeLaserKey = (...parts) =>
    parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const withSkinTone = (colors) => ({ ...colors, ...SKIN_TONE });

const colorDeltasForDevice = (manufacturer, model) => {
    const key = normalizeLaserKey(manufacturer, model);
    const compact = key.replace(/ /g, '');
    if (!key) return null;
    const match = LASER_COLOR_PROFILES.find((profile) =>
        profile.keys.some((candidate) => candidate === key || candidate === compact)
    );
    return match ? withSkinTone(match.colors) : null;
};

const DEFAULT_LASER_COLOR_DELTAS = withSkinTone(LASER_COLOR_PROFILES[0].colors);

module.exports = {
    LASER_COLOR_PROFILES,
    colorDeltasForDevice,
    DEFAULT_LASER_COLOR_DELTAS,
};
