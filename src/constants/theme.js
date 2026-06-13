// Shared visual tokens for the CircuitScope observatory redesign.
// The legacy keys remain available because many SVG components consume them directly.

export const darkTheme = {
  mode: 'dark',
  bg: '#07090d',
  bgLight: '#0d1418',
  bgLighter: '#131f26',
  panel: 'rgba(15, 24, 30, 0.78)',
  panelSolid: '#111b22',
  panelRaised: '#17262e',
  panelWarm: 'rgba(53, 35, 21, 0.52)',
  field: '#091014',
  fieldAlt: '#111920',
  glass: 'rgba(18, 29, 36, 0.68)',
  glassStrong: 'rgba(23, 38, 47, 0.9)',
  line: 'rgba(171, 196, 191, 0.16)',
  lineStrong: 'rgba(137, 182, 181, 0.34)',
  lineWarm: 'rgba(246, 184, 95, 0.28)',
  accent: '#78d8d0',
  accentDim: '#244f55',
  accentSoft: 'rgba(120, 216, 208, 0.14)',
  copper: '#c98552',
  copperDim: '#62422b',
  copperSoft: 'rgba(201, 133, 82, 0.16)',
  amber: '#f3b65f',
  amberDim: '#60411e',
  amberSoft: 'rgba(243, 182, 95, 0.16)',
  error: '#ff6f7d',
  errorDim: '#6a2730',
  errorSoft: 'rgba(255, 111, 125, 0.15)',
  measureSoft: 'rgba(123, 215, 167, 0.15)',
  // Highlighted error gradient (timeline): must contrast with flat errorDim
  errorBright: '#ff6f7d',
  errorDeep: '#6a2730',
  success: '#77d394',
  warning: '#f3b65f',
  text: '#f0eadf',
  textDim: '#98a7a2',
  textFaint: '#66746f',
  qubit: '#76b7d8',
  gate: '#a78bdc',
  measure: '#7bd7a7',
  detector: '#f3b65f',
  detectorBright: '#ffd17e',
  observable: '#d987ba',
  shadow: '0 26px 80px rgba(0, 0, 0, 0.38)',
  shadowSoft: '0 18px 46px rgba(0, 0, 0, 0.26)',
};

// Light mode is warm paper/cream rather than cold blue-white: same instrument
// in daylight. Accent hues match dark mode; only the neutral ramp is re-tinted.
export const lightTheme = {
  mode: 'light',
  bg: '#f2ede3',
  bgLight: '#faf6ec',
  bgLighter: '#fffdf6',
  panel: 'rgba(255, 252, 243, 0.78)',
  panelSolid: '#fcf9f0',
  panelRaised: '#fffdf6',
  panelWarm: 'rgba(252, 240, 219, 0.85)',
  field: '#f6f1e7',
  fieldAlt: '#ece5d7',
  glass: 'rgba(255, 252, 243, 0.72)',
  glassStrong: 'rgba(255, 253, 247, 0.94)',
  line: 'rgba(72, 59, 38, 0.14)',
  lineStrong: 'rgba(38, 90, 88, 0.30)',
  lineWarm: 'rgba(176, 105, 52, 0.24)',
  accent: '#147f86',
  accentDim: '#9fc9c8',
  accentSoft: 'rgba(20, 127, 134, 0.11)',
  copper: '#a86235',
  copperDim: '#d8b595',
  copperSoft: 'rgba(168, 98, 53, 0.12)',
  amber: '#b8752c',
  amberDim: '#e4c797',
  amberSoft: 'rgba(184, 117, 44, 0.12)',
  error: '#bf3448',
  errorDim: '#c95f72',
  errorSoft: 'rgba(191, 52, 72, 0.12)',
  measureSoft: 'rgba(47, 139, 100, 0.12)',
  // Hotter and deeper than the flat errorDim fill so highlights still pop
  errorBright: '#e23a55',
  errorDeep: '#7a1525',
  success: '#277c55',
  warning: '#b8752c',
  text: '#2a2520',
  textDim: '#6b6457',
  textFaint: '#90897a',
  qubit: '#2e7ca1',
  gate: '#7254a0',
  measure: '#2f8b64',
  detector: '#b8752c',
  detectorBright: '#8a531f',
  observable: '#9c4f82',
  shadow: '0 24px 70px rgba(58, 46, 28, 0.16)',
  shadowSoft: '0 16px 42px rgba(58, 46, 28, 0.12)',
};

export const C = darkTheme;

// Each view's accent identity, shared by the MainPanel title bar and the
// header's active view tab so the tab you click and the title you land on
// agree. Hues are semantic, reusing the color the view's content is drawn in:
// timeline = detector amber, analysis = formula teal, compare = measured-data
// green, code = copper (raw source), DEM = error rose.
export function viewAccent(C, mode) {
  const map = {
    timeline: { main: C.detector, bright: C.detectorBright, soft: C.amberSoft },
    analysis: { main: C.accent, soft: C.accentSoft },
    compare: { main: C.measure, soft: C.measureSoft },
    code: { main: C.copper, soft: C.copperSoft },
    dem: { main: C.error, soft: C.errorSoft },
  };
  const { main, bright, soft } = map[mode] || map.timeline;
  return {
    main,
    soft,
    gradient: `linear-gradient(180deg, ${bright || main}, color-mix(in srgb, ${main} 72%, ${C.bg}))`,
  };
}
