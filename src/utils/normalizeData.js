// Normalize circuit data from the backend for frontend use

const errorTypes = new Set(['DEPOLARIZE1', 'DEPOLARIZE2', 'X_ERROR', 'Y_ERROR', 'Z_ERROR', 'PAULI_CHANNEL_1', 'PAULI_CHANNEL_2']);
const gateTypes = new Set(['CX', 'CZ', 'CY', 'CNOT', 'SWAP', 'ISWAP', 'XCX', 'XCZ', 'YCX', 'YCZ', 'H', 'S', 'T', 'X', 'Y', 'Z', 'SQRT_X', 'SQRT_Y', 'SQRT_Z']);
const measureTypes = new Set(['M', 'MR', 'MX', 'MY', 'MZ', 'MRX', 'MRY', 'MRZ']);
const initTypes = new Set(['R', 'RX', 'RY', 'RZ']);

export function normalizeCircuitData(raw) {
  if (!raw) return null;

  const normalizeLocations = (locations = []) => locations.map((l) => {
    const tick = l.tick ?? l.tick_offset ?? l.tickOffset ?? 0;
    const name = l.instruction_name || l.name || l.instruction || 'op';
    const rate = l.error_rate ?? l.rate ?? null;
    const qubits = l.qubits || [];
    return {
      ...l,
      tick,
      tick_offset: tick,
      name,
      instruction_name: name,
      instruction: l.instruction || `${name}${qubits.length ? ` ${qubits.join(' ')}` : ''}`,
      rate,
      error_rate: rate,
      qubits
    };
  });

  const normalizeOps = (ops = []) => ops.map((op, index) => {
    const name = op.name;
    const rate = op.rate ?? op.error_rate ?? null;
    const qubits = op.qubits || [];
    const order = op.order ?? index; // Use provided order or fall back to array index
    let type = op.type;
    if (!type) {
      if (errorTypes.has(name)) type = 'error';
      else if (measureTypes.has(name)) type = 'measure';
      else if (initTypes.has(name)) type = 'init';
      else if (gateTypes.has(name)) type = 'gate';
      else type = 'other';
    }
    return { ...op, name, rate, qubits, type, order };
  });

  const detector_errors = (raw.detector_errors || []).map((err) => ({
    ...err,
    dem_terms: err.dem_terms || [],
    locations: normalizeLocations(err.locations)
  }));

  const timeline = (raw.timeline || []).map((t) => ({
    tick: t.tick ?? t.tick_offset ?? 0,
    ops: normalizeOps(t.ops)
  }));

  const allQubits = timeline.flatMap((t) => t.ops.flatMap((op) => {
    if (!op.qubits) return [];
    return Array.isArray(op.qubits[0]) ? op.qubits.flat() : op.qubits;
  }));
  const inferredNumQubits = allQubits.length ? Math.max(...allQubits) + 1 : 0;
  const inferredNumDetectors = raw.detectors ? raw.detectors.length : (raw.detector_errors ? raw.detector_errors.length : 0);

  // Map detectors, preserving tick/qubit from backend (measurement-based positioning)
  const detectors = (raw.detectors || []).map(d => ({
    ...d,
    tick: d.tick ?? 0,
    qubit: d.qubit ?? 0,
    measurement_indices: d.measurement_indices || [],
  }));

  // Pass through measurements array (each has {tick, qubit, index})
  const measurements = raw.measurements || [];

  return {
    circuit_text: raw.circuit_text || '',
    detectors,
    detector_errors,
    timeline,
    measurements,
    num_qubits: raw.num_qubits ?? inferredNumQubits,
    num_detectors: raw.num_detectors ?? inferredNumDetectors,
    detailed_budgets: raw.detailed_budgets || null,
    detecting_regions: raw.detecting_regions || null
  };
}
