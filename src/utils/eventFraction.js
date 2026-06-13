// Event Fraction Computation Utilities (for interactive parameter editing)

// Depolarizing decorrelation: convert DEPOLARIZE1 probability to effective single-Pauli probability
export function decorrelatedDepolarize1(d) {
  // p_eff = 0.5 - 0.5 * sqrt(1 - 4d/3)
  return 0.5 - 0.5 * Math.sqrt(Math.max(0, 1 - (4 / 3) * d));
}

// Depolarizing decorrelation: convert DEPOLARIZE2 probability to effective single-Pauli probability
export function decorrelatedDepolarize2(d) {
  // p_eff = 0.5 - 0.5 * (1 - 16d/15)^(1/8)
  return 0.5 - 0.5 * Math.pow(Math.max(1e-10, 1 - (16 / 15) * d), 1 / 8);
}

// Get effective probability for any gate type
export function getEffectiveP(gateType, value) {
  if (gateType === 'DEPOLARIZE1') return decorrelatedDepolarize1(value);
  if (gateType === 'DEPOLARIZE2') return decorrelatedDepolarize2(value);
  return value; // X_ERROR, Y_ERROR, Z_ERROR, etc.
}

// Rewrite params with each parameter's count for a specific detector.
// detectorCounts is { param_name: [count_for_d0, count_for_d1, ...] }
function paramsForDetector(params, detectorCounts, detId) {
  return params.map(p => ({ ...p, count: detectorCounts[p.name]?.[detId] ?? 0 }));
}

// Per-detector event fractions (indexed by detector id) under the given
// parameter values — used to keep all surfaces live while parameters are
// modified anywhere in the app.
export function computeDetectorFractions(params, detectorCounts, numDetectors) {
  return Array.from({ length: numDetectors }, (_, detId) =>
    computeEventFraction(paramsForDetector(params, detectorCounts, detId))
  );
}

// Compute event fraction from parameters: P(D) = 0.5 * (1 - Π(1 - 2*p_eff)^count)
export function computeEventFraction(params) {
  let prod = 1.0;
  for (const p of params) {
    const pEff = getEffectiveP(p.gate_type, p.value);
    prod *= Math.pow(1 - 2 * pEff, p.count);
  }
  return 0.5 * (1 - prod);
}

// Compute average event fraction across all detectors
export function computeAverageEventFraction(params, detectorCounts, numDetectors) {
  let total = 0.0;
  for (let detId = 0; detId < numDetectors; detId++) {
    total += computeEventFraction(paramsForDetector(params, detectorCounts, detId));
  }
  return total / numDetectors;
}

// Compute derivative of p_eff with respect to original parameter
export function dpEffDp(gateType, value) {
  if (gateType === 'DEPOLARIZE1') {
    // d/dp [0.5 - 0.5*sqrt(1 - 4p/3)] = 1/(3*sqrt(1 - 4p/3))
    const x = Math.max(1e-10, 1 - (4 / 3) * value);
    return 1 / (3 * Math.sqrt(x));
  } else if (gateType === 'DEPOLARIZE2') {
    // d/dp [0.5 - 0.5*(1-16p/15)^(1/8)] = (1/15)*(1-16p/15)^(-7/8)
    const x = Math.max(1e-10, 1 - (16 / 15) * value);
    return (1 / 15) * Math.pow(x, -7 / 8);
  }
  return 1.0; // X_ERROR, Y_ERROR, Z_ERROR: p_eff = p, so derivative is 1
}

// Compute sensitivities (∂P/∂p for each parameter)
// Formula: sensitivity_j = count_j * (∂p_eff_j/∂p_j) * prod / (1 - 2*p_eff_j)
export function computeSensitivities(params) {
  if (!params.length) return [];

  // Compute all p_eff values
  const pEffs = params.map(p => getEffectiveP(p.gate_type, p.value));

  // Compute prod = Π(1 - 2*p_eff)^count
  let prod = 1.0;
  for (let i = 0; i < params.length; i++) {
    prod *= Math.pow(1 - 2 * pEffs[i], params[i].count);
  }

  // Compute sensitivity for each parameter
  return params.map((p, i) => {
    if (p.count === 0) return 0;
    const denom = 1 - 2 * pEffs[i];
    if (Math.abs(denom) < 1e-10) return Infinity;
    return p.count * dpEffDp(p.gate_type, p.value) * prod / denom;
  });
}

// Compute average sensitivity for average formula
// Returns average of per-detector sensitivities
export function computeAverageSensitivities(params, detectorCounts, numDetectors) {
  if (!params.length) return [];

  const totals = params.map(() => 0);
  for (let detId = 0; detId < numDetectors; detId++) {
    const sens = computeSensitivities(paramsForDetector(params, detectorCounts, detId));
    sens.forEach((s, i) => { totals[i] += s; });
  }
  return totals.map(s => s / numDetectors);
}

// Compute log-weight contribution for each parameter
// w_j = count_j * -log(1 - 2*p_eff_j)
// contribution_j = w_j / sum(all w)
export function computeContributions(params) {
  if (!params.length) return [];

  // Compute log-weights for each parameter
  const logWeights = params.map(p => {
    const pEff = getEffectiveP(p.gate_type, p.value);
    const term = 1 - 2 * pEff;
    if (term <= 0) return Infinity;
    return p.count * -Math.log(term);
  });

  // Compute total log-weight
  const totalWeight = logWeights.reduce((sum, w) => sum + w, 0);

  // Return contributions (fraction of total)
  if (totalWeight === 0 || !isFinite(totalWeight)) {
    return params.map(() => 0);
  }
  return logWeights.map(w => w / totalWeight);
}

// Compute average contribution for the "Average" detector selection.
// For each detector d:
//   w_{jd} = c_{jd} * -log(1 - 2*p_eff,j)
//   s_{jd} = w_{jd} / Σ_k w_{kd}
// Then report the P(D_d)-weighted average:
//   S_j = (Σ_d P(D_d) * s_{jd}) / (Σ_d P(D_d))
export function computeAverageContributions(params, detectorCounts, numDetectors) {
  if (!params.length) return [];

  const pEffs = params.map(p => getEffectiveP(p.gate_type, p.value));
  const terms = pEffs.map(pEff => 1 - 2 * pEff);
  const logTerms = terms.map(term => (term > 0 ? -Math.log(term) : Infinity));

  const weightedShares = params.map(() => 0);
  let totalEventFraction = 0;

  for (let detId = 0; detId < numDetectors; detId++) {
    let prod = 1.0;
    let totalLogW = 0.0;
    const detLogWeights = params.map((p, i) => {
      const count = detectorCounts[p.name]?.[detId] ?? 0;
      if (count === 0) return 0;

      prod *= Math.pow(terms[i], count);

      const w = count * logTerms[i];
      totalLogW += w;
      return w;
    });

    // Detector event fraction P(D_d).
    const detP = 0.5 * (1 - prod);
    if (!(detP > 0)) continue;

    // If there are no weights for this detector, skip it.
    if (totalLogW === 0) continue;

    // If any term is non-positive, logTerms[i] becomes Infinity; apportion among the infinite entries.
    if (!isFinite(totalLogW)) {
      const infiniteIndices = detLogWeights
        .map((w, i) => (w === Infinity ? i : -1))
        .filter(i => i >= 0);
      if (infiniteIndices.length === 0) continue;

      const share = 1 / infiniteIndices.length;
      totalEventFraction += detP;
      for (const i of infiniteIndices) {
        weightedShares[i] += detP * share;
      }
      continue;
    }

    totalEventFraction += detP;
    for (let i = 0; i < params.length; i++) {
      const w = detLogWeights[i];
      if (w === 0) continue;
      weightedShares[i] += detP * (w / totalLogW);
    }
  }

  if (totalEventFraction === 0 || !isFinite(totalEventFraction)) {
    return params.map(() => 0);
  }
  return weightedShares.map(x => x / totalEventFraction);
}
