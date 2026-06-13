// Measured detector data: parsing, model comparison statistics, persistence.
//
// CircuitScope deliberately imports only per-detector average event fractions
// plus an optional shot count (not raw detection event data) — that is enough
// to compare a lab run against the Stim noise model without hauling around
// large datasets.

const MEASURED_DATA_KEY = 'circuitscope-measured-data';

// Accept "D12", "d12", or "12" as a detector id token; normalize to "D12".
function normalizeDetectorName(token) {
  const m = String(token).trim().match(/^[Dd]?(\d+)$/);
  return m ? `D${Number(m[1])}` : null;
}

function parseFraction(token) {
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

// Parse pasted measured data. Supported formats:
//
// JSON:
//   [0.012, 0.034, ...]                          fractions in detector order
//   {"D0": 0.012, "D1": 0.034}                   fractions by detector name
//   {"shots": 100000, "fractions": <either of the above>}
//
// CSV / whitespace-delimited lines (optional header line, "#" comments):
//   0.012                       one fraction per line, detector order
//   D0, 0.012                   detector id and fraction
//   shots, 100000               optional shot count line
//
// Returns { fractions: {name: value}, shots: number|null }.
// Throws Error with a user-facing message on unparseable input.
export function parseMeasuredData(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('No data provided.');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error('Input looks like JSON but failed to parse.');
    }
    return fromJson(json);
  }
  return fromLines(trimmed);
}

function fromJson(json) {
  let shots = null;
  let source = json;
  if (!Array.isArray(json) && typeof json === 'object' && json !== null && 'fractions' in json) {
    if (json.shots != null) {
      shots = Number(json.shots);
      if (!Number.isFinite(shots) || shots <= 0) throw new Error(`Invalid shots value: ${json.shots}`);
    }
    source = json.fractions;
  }

  const fractions = {};
  if (Array.isArray(source)) {
    source.forEach((v, i) => {
      const f = parseFraction(v);
      if (f === null) throw new Error(`Entry ${i} is not a number: ${JSON.stringify(v)}`);
      fractions[`D${i}`] = f;
    });
  } else if (typeof source === 'object' && source !== null) {
    for (const [key, v] of Object.entries(source)) {
      const name = normalizeDetectorName(key);
      if (!name) throw new Error(`Unrecognized detector key: "${key}" (expected "D0" or "0")`);
      const f = parseFraction(v);
      if (f === null) throw new Error(`Value for ${name} is not a number: ${JSON.stringify(v)}`);
      fractions[name] = f;
    }
  } else {
    throw new Error('JSON must be an array of fractions or an object mapping detectors to fractions.');
  }
  return { fractions, shots };
}

function fromLines(text) {
  const fractions = {};
  let shots = null;
  let implicitIndex = 0;
  let sawNamed = false;
  let sawImplicit = false;

  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  lines.forEach((line, lineNo) => {
    const tokens = line.split(/[,\t;]+|\s+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return;

    if (/^shots$/i.test(tokens[0])) {
      const v = Number(tokens[1]);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid shots value on line ${lineNo + 1}: "${line}"`);
      shots = v;
      return;
    }

    // Skip a header line like "detector,fraction"
    if (lineNo === 0 && tokens.every(t => parseFraction(t) === null && !normalizeDetectorName(t))) return;

    if (tokens.length === 1) {
      const f = parseFraction(tokens[0]);
      if (f === null) throw new Error(`Line ${lineNo + 1} is not a number: "${line}"`);
      fractions[`D${implicitIndex++}`] = f;
      sawImplicit = true;
    } else {
      const name = normalizeDetectorName(tokens[0]);
      const f = parseFraction(tokens[1]);
      if (!name || f === null) throw new Error(`Could not parse line ${lineNo + 1}: "${line}" (expected "D0, 0.012")`);
      fractions[name] = f;
      sawNamed = true;
    }
  });

  if (sawNamed && sawImplicit) {
    throw new Error('Mix of named ("D0, 0.012") and bare ("0.012") lines; use one style.');
  }
  if (!Object.keys(fractions).length) throw new Error('No detector fractions found in input.');
  return { fractions, shots };
}

// Check parsed data against the analyzed circuit's detectors.
// Returns { errors: [...], warnings: [...] } of user-facing strings.
export function validateMeasuredData(parsed, detectors) {
  const errors = [];
  const warnings = [];
  const known = new Set(detectors.map(d => d.name));

  const outOfRange = Object.entries(parsed.fractions).filter(([, v]) => v < 0 || v > 1);
  if (outOfRange.length) {
    errors.push(`Fractions must be in [0, 1]: ${outOfRange.slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')}${outOfRange.length > 4 ? ', …' : ''}`);
  }

  const unknown = Object.keys(parsed.fractions).filter(name => !known.has(name));
  if (unknown.length) {
    errors.push(`Data references detectors not in this circuit: ${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ', …' : ''} (circuit has ${known.size})`);
  }

  const covered = Object.keys(parsed.fractions).filter(name => known.has(name)).length;
  if (!errors.length && covered < known.size) {
    warnings.push(`Data covers ${covered} of ${known.size} detectors; the rest will show model values only.`);
  }
  if (parsed.shots == null) {
    warnings.push('No shot count given — residuals will be shown without σ error bars.');
  }
  return { errors, warnings };
}

// Comparison statistics for one detector under the hypothesis that the model
// is correct: the sampled fraction has standard deviation
// sqrt(p_model * (1 - p_model) / shots). The variance is floored at 1/shots²
// so a p_model of exactly 0 still yields a finite, meaningful z
// (z then equals the number of observed events).
export function compareDetector(modelFraction, measuredFraction, shots) {
  const delta = measuredFraction - modelFraction;
  if (!shots) return { measured: measuredFraction, model: modelFraction, delta, sigma: null, z: null };
  const variance = Math.max(modelFraction * (1 - modelFraction), 1 / shots) / shots;
  const sigma = Math.sqrt(variance);
  return { measured: measuredFraction, model: modelFraction, delta, sigma, z: delta / sigma };
}

// Build a {detectorName: stats} map for all detectors that have measured data.
export function buildComparison(detectors, measuredData) {
  if (!measuredData) return null;
  const comparison = {};
  detectors.forEach(d => {
    const measured = measuredData.fractions[d.name];
    if (measured == null) return;
    comparison[d.name] = compareDetector(d.event_fraction || 0, measured, measuredData.shots);
  });
  return Object.keys(comparison).length ? comparison : null;
}

// Format a z-score for display ("+2.3σ"). Above ±99 the precise value carries
// no extra information, so clamp the label.
export function formatZ(z) {
  if (z == null) return null;
  if (Math.abs(z) > 99) return `${z > 0 ? '>+' : '<-'}99σ`;
  return `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`;
}

// Persistence: remember the last imported dataset together with the circuit
// it was measured against, so reloading the app (or re-analyzing a tweaked
// model of the same experiment) doesn't require re-importing.
export function readStoredMeasuredData() {
  try {
    const raw = localStorage.getItem(MEASURED_DATA_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (!stored?.fractions || typeof stored.fractions !== 'object') return null;
    return stored; // { circuit, shots, fractions }
  } catch {
    return null;
  }
}

export function saveStoredMeasuredData(circuitText, measuredData) {
  try {
    if (!measuredData) {
      localStorage.removeItem(MEASURED_DATA_KEY);
      return;
    }
    localStorage.setItem(MEASURED_DATA_KEY, JSON.stringify({
      circuit: circuitText,
      shots: measuredData.shots,
      fractions: measuredData.fractions,
    }));
  } catch {
    // Storage unavailable (private mode/quota); persistence is best-effort.
  }
}
