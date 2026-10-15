/**
 * Platform colour deltas are fallbacks. Per-laser maps store only overrides.
 */
const {
    mergeLaserColorMaps,
    mergeSessionPrediction,
    sparseLaserColorMap,
    sparseLaserColorOverrides,
} = require('../config/sessionPredictionDefaults');

const check = (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) process.exitCode = 1;
};

const platform = { black: 0, grey: 0, red: 1, orange: 1, blue: 1, green: 2, purple: 2, yellow: 3, white: 3, skin_tone: 3 };

const picoplus = sparseLaserColorMap({ ...platform, green: 4, orange: 2 }, platform);
check(picoplus.green === 4 && picoplus.orange === 2 && picoplus.black === undefined, 'only differing colours stay as overrides');

const inherited = sparseLaserColorMap(platform, platform);
check(Object.keys(inherited).length === 0, 'prefilled defaults are not stored as overrides');

const merged = mergeLaserColorMaps({ pico: { green: 4, orange: 2 } }, { pico: { green: 4 } });
check(merged.pico.orange === undefined && merged.pico.green === 4, 'saving a laser replaces its override map (reset orange inherits again)');

const cleared = mergeLaserColorMaps({ pico: { green: 4 } }, { pico: {} });
check(!cleared.pico, 'empty override map removes the laser so every colour inherits');

const otherKept = mergeLaserColorMaps({ pico: { green: 4 }, other: { yellow: 5 } }, { pico: { green: 6 } });
check(otherKept.other.yellow === 5 && otherKept.pico.green === 6, 'a patch for one laser leaves other lasers unchanged');

const session = mergeSessionPrediction({
    tattoo_deltas: { color: platform },
    laser_color_overrides: {
        pico: { ...platform, green: 4 },
        copy: { ...platform },
    },
});
check(session.laser_color_overrides.pico.green === 4, 'full PicoPlus copy sparsifies to the green override');
check(!session.laser_color_overrides.copy, 'laser copied from defaults inherits and is omitted');

const afterDefaultChange = sparseLaserColorOverrides(session.laser_color_overrides, { ...platform, green: 5 });
check(afterDefaultChange.pico.green === 4, 'explicit PicoPlus green +4 stays when the global default moves');
check(!afterDefaultChange.copy, 'lasers without overrides keep inheriting after the global default changes');

if (process.exitCode) {
    console.error('Laser colour inheritance checks failed.');
    process.exit(1);
}
console.log('Laser colour inheritance checks passed.');
