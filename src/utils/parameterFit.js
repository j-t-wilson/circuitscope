// Weighted least-squares fitting of noise parameters to measured detector
// event fractions.
//
// Every detector's event fraction has the form
//   P_i = 0.5 * (1 - Π_j (1 - 2*q_j)^c_ij)
// where q_j is the effective toggle probability of parameter j and c_ij is
// the integer count matrix exported by the average-formula endpoint
// (detector_counts). In transformed coordinates
//   y_i = ln(1 - 2*P_i),   x_j = ln(1 - 2*q_j)
// the model is exactly linear, y = C·x, so fitting is closed-form weighted
// linear least squares — no iterative optimizer.
//
// Measurement weights use the model-is-correct hypothesis (same convention as
// compareDetector): sigma_P = sqrt(max(p(1-p), 1/shots)/shots), propagated to
// the transformed coordinate as sigma_y = 2*sigma_P/(1 - 2p). Reported chi²
// is recomputed in probability space under each candidate model, so ranking
// matches the z-scores shown elsewhere in the app.

import { getEffectiveP, dpEffDp } from './eventFraction.js';

// Floor for (1 - 2p) terms before taking logs; p at or beyond 0.5 saturates
// the model and carries no rate information.
const MIN_TERM = 1e-12;

// Relative ridge strength anchoring the fit to nominal rates. Strong enough
// to keep rank-deficient directions at the model the user wrote down, weak
// enough not to disturb well-constrained parameters.
const RIDGE = 1e-6;

function toX(gateType, rate) {
  const q = getEffectiveP(gateType, rate);
  return Math.log(Math.max(1 - 2 * q, MIN_TERM));
}

// Inverse of the transform chain: x -> effective toggle q -> raw gate rate
// (inverting the depolarizing decorrelation in closed form).
export function rateFromX(gateType, x) {
  const e = Math.exp(Math.min(x, 0)); // e = 1 - 2q
  if (gateType === 'DEPOLARIZE1') return 0.75 * (1 - e * e);
  if (gateType === 'DEPOLARIZE2') return (15 / 16) * (1 - Math.pow(e, 8));
  return (1 - e) / 2;
}

function sigmaP(p, shots) {
  return Math.sqrt(Math.max(p * (1 - p), 1 / shots) / shots);
}

function predictP(c, x) {
  let s = 0;
  for (let j = 0; j < c.length; j++) {
    if (c[j]) s += c[j] * x[j];
  }
  return 0.5 * (1 - Math.exp(s));
}

// Assemble the linear problem from the average-formula model and a measured
// dataset. Rows are detectors with measured data; columns are parameters.
export function buildFitProblem(model, measuredData) {
  const params = model.parameters || [];
  const shots = measuredData?.shots || null;
  const counts = model.detector_counts || {};
  const warnings = [];

  const x0 = params.map(p => toX(p.gate_type, p.original_value));

  const rows = [];
  for (const [name, rawF] of Object.entries(measuredData.fractions)) {
    const m = /^D(\d+)$/.exec(name);
    if (!m) continue;
    const det = Number(m[1]);
    if (det >= (model.num_detectors || 0)) continue;
    let measured = rawF;
    if (measured > 0.5 - 1e-9) {
      warnings.push(`${name}: measured fraction ≥ 50% saturates the model and carries no rate information.`);
      measured = 0.5 - 1e-9;
    }
    rows.push({
      name,
      det,
      c: params.map(p => counts[p.name]?.[det] ?? 0),
      measured,
    });
  }
  rows.sort((a, b) => a.det - b.det);

  for (const row of rows) {
    row.y = Math.log(Math.max(1 - 2 * row.measured, MIN_TERM));
    if (shots) {
      const pNom = predictP(row.c, x0);
      const sy = (2 * sigmaP(pNom, shots)) / Math.max(1 - 2 * pNom, 1e-9);
      row.w = 1 / (sy * sy);
    } else {
      row.w = 1;
    }
  }

  // A parameter with no counts in any measured row cannot be constrained.
  const leverage = params.map((_, j) => rows.some(r => r.c[j] > 0));

  return { params, shots, rows, x0, leverage, warnings };
}

// Probability-space goodness of fit for a candidate x, sigma evaluated under
// the candidate model (consistent with compareDetector's z-scores).
export function goodnessOfFit(problem, x, freeCount) {
  let chi2 = 0;
  let ssr = 0;
  for (const row of problem.rows) {
    const p = predictP(row.c, x);
    const r = row.measured - p;
    ssr += r * r;
    if (problem.shots) {
      const s = sigmaP(p, problem.shots);
      chi2 += (r / s) * (r / s);
    }
  }
  const n = problem.rows.length;
  const dof = Math.max(1, n - freeCount);
  return {
    chi2: problem.shots ? chi2 : null,
    perDof: problem.shots ? chi2 / dof : null,
    dof,
    rms: Math.sqrt(ssr / Math.max(1, n)),
  };
}

// Gaussian elimination with partial pivoting. Returns null when singular.
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-300) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Minimize Σ w_i (y_i - Σ_j c_ij x_j)² over x_j for j in freeIdx, with the
// remaining parameters fixed (at nominal, or at zero once clamped) and a
// ridge anchor to nominal. Rates cannot be negative, which in transformed
// coordinates means x_j ≤ 0: positive solutions are clamped to the zero-rate
// boundary and the rest refit (tiny active-set loop).
function solveSubset(problem, freeIdx) {
  const { rows, x0 } = problem;
  const nParams = x0.length;
  const x = x0.slice();
  let free = freeIdx.slice();
  const clamped = [];

  for (let pass = 0; pass <= freeIdx.length; pass++) {
    const k = free.length;
    if (!k) return { x, free, clamped, normal: null };

    const isFree = new Array(nParams).fill(false);
    free.forEach(j => { isFree[j] = true; });

    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const b = new Array(k).fill(0);
    for (const row of rows) {
      let yAdj = row.y;
      for (let j = 0; j < nParams; j++) {
        if (!isFree[j] && row.c[j]) yAdj -= row.c[j] * x[j];
      }
      for (let a = 0; a < k; a++) {
        const ca = row.c[free[a]];
        if (!ca) continue;
        const wca = row.w * ca;
        b[a] += wca * yAdj;
        for (let bi = a; bi < k; bi++) {
          const cb = row.c[free[bi]];
          if (cb) A[a][bi] += wca * cb;
        }
      }
    }
    for (let a = 0; a < k; a++) {
      for (let bi = 0; bi < a; bi++) A[a][bi] = A[bi][a];
    }
    for (let a = 0; a < k; a++) {
      const lam = RIDGE * (A[a][a] || 1);
      A[a][a] += lam;
      b[a] += lam * x0[free[a]];
    }

    const sol = solveLinear(A, b);
    if (!sol) return null;

    const over = [];
    free.forEach((j, a) => {
      x[j] = sol[a];
      if (sol[a] > 0) over.push(j);
    });
    if (!over.length) return { x, free, clamped, normal: A };

    for (const j of over) {
      x[j] = 0;
      clamped.push(j);
    }
    free = free.filter(j => !over.includes(j));
  }
  return null;
}

// Posterior sigma of each free parameter, in raw-rate units, from the
// inverse of the (ridge-stabilized) normal matrix.
function rateSigmas(problem, result) {
  const out = {};
  const { normal, free, x } = result;
  if (!normal) return out;
  const k = free.length;
  for (let a = 0; a < k; a++) {
    const e = new Array(k).fill(0);
    e[a] = 1;
    const col = solveLinear(normal.map(r => r.slice()), e);
    if (!col || col[a] <= 0) continue;
    const j = free[a];
    const sigmaX = Math.sqrt(col[a]);
    const p = problem.params[j];
    const rate = rateFromX(p.gate_type, x[j]);
    // dp/dx = (dq/dx)/(dq/dp); |dq/dx| = e^x / 2
    const dpDx = Math.exp(x[j]) / 2 / dpEffDp(p.gate_type, rate);
    out[p.name] = sigmaX * dpDx;
  }
  return out;
}

function makeScenario(problem, result, indices, fit) {
  const changes = indices.map(j => {
    const p = problem.params[j];
    const to = rateFromX(p.gate_type, result.x[j]);
    return {
      name: p.name,
      gateType: p.gate_type,
      from: p.original_value,
      to,
      mult: p.original_value > 0 ? to / p.original_value : null,
      clamped: result.clamped.includes(j),
    };
  });
  return { indices, changes, fit };
}

// Ranking key: chi² when shots are known, otherwise probability-space RMS.
function fitQuality(s) {
  return s.fit.chi2 != null ? s.fit.chi2 : s.fit.rms;
}

// Group parameters whose count columns are exactly proportional across the
// measured detectors: the data only constrains their combination.
function findDegenerateGroups(problem, freeAll) {
  const sig = new Map();
  for (const j of freeAll) {
    const col = problem.rows.map(r => r.c[j]);
    const first = col.find(v => v !== 0);
    if (!first) continue;
    const key = col.map(v => (v / first).toPrecision(10)).join(',');
    if (!sig.has(key)) sig.set(key, []);
    sig.get(key).push(problem.params[j].name);
  }
  return [...sig.values()].filter(g => g.length > 1);
}

// Run the full fit: nominal goodness of fit, ranked single-knob scenarios,
// greedy two-knob scenarios seeded by the best single, the dense fit over
// all constrained parameters, and identifiability notes.
export function runFit(model, measuredData) {
  if (!model?.parameters?.length || !measuredData?.fractions) return null;
  const problem = buildFitProblem(model, measuredData);
  if (!problem.rows.length) return null;

  const nominal = goodnessOfFit(problem, problem.x0, 0);
  const freeAll = problem.params.map((_, j) => j).filter(j => problem.leverage[j]);
  const noLeverage = problem.params.filter((_, j) => !problem.leverage[j]).map(p => p.name);

  const singles = [];
  for (const j of freeAll) {
    const result = solveSubset(problem, [j]);
    if (!result) continue;
    singles.push(makeScenario(problem, result, [j], goodnessOfFit(problem, result.x, 1)));
  }
  singles.sort((a, b) => fitQuality(a) - fitQuality(b));

  const pairs = [];
  if (singles.length && freeAll.length > 1) {
    const jBest = singles[0].indices[0];
    for (const j of freeAll) {
      if (j === jBest) continue;
      const result = solveSubset(problem, [jBest, j]);
      if (!result) continue;
      pairs.push(makeScenario(problem, result, [jBest, j], goodnessOfFit(problem, result.x, 2)));
    }
    pairs.sort((a, b) => fitQuality(a) - fitQuality(b));
  }

  let dense = null;
  if (freeAll.length) {
    const result = solveSubset(problem, freeAll);
    if (result) {
      dense = makeScenario(problem, result, freeAll, goodnessOfFit(problem, result.x, freeAll.length));
      dense.sigmas = rateSigmas(problem, result);
    }
  }

  return {
    nominal,
    singles: singles.slice(0, 5),
    pairs: pairs.slice(0, 3),
    dense,
    noLeverage,
    degenerateGroups: findDegenerateGroups(problem, freeAll),
    uniquePatterns: new Set(problem.rows.map(r => r.c.join(','))).size,
    numRows: problem.rows.length,
    shots: problem.shots,
    warnings: problem.warnings,
  };
}
