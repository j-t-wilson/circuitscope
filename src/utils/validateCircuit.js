// Validate circuit for common issues that may break visualization

export function validateCircuit(circuitText) {
  const warnings = [];
  const lines = circuitText.split('\n');

  // Check for MR (measure-reset) operations which cause detecting region issues
  if (/^\s*MR[XYZ]?\b/m.test(circuitText)) {
    warnings.push({
      type: 'mr_operation',
      message: 'MR (measure-reset) operations are not well supported and may cause incorrect detecting region visualization. Consider using separate M and R operations instead.'
    });
  }

  // Track operations per qubit within current tick to detect missing TICKs
  let qubitOpsInTick = {}; // qubit -> array of operation names
  let foundMissingTick = false;

  // Track if we've seen a measurement since last TICK (for detector placement check)
  let hasMeasurementSinceLastTick = false;
  let hadTickSinceMeasurement = false;
  let foundDetectorAfterTick = false;

  // Metadata commands that are OK between measurement and detector
  const metadataCommands = new Set(['SHIFT_COORDS', 'QUBIT_COORDS', 'MPAD', 'OBSERVABLE_INCLUDE']);

  // Commands that operate on qubits (simplified list)
  const qubitCommands = /^(R|RX|RY|RZ|M|MR|MX|MY|MZ|MRX|MRY|MRZ|H|S|T|X|Y|Z|CX|CZ|CY|CNOT|SWAP|ISWAP|XCX|XCZ|YCX|YCZ|SQRT_X|SQRT_Y|SQRT_Z|DEPOLARIZE1|DEPOLARIZE2|X_ERROR|Y_ERROR|Z_ERROR|PAULI_CHANNEL_1|PAULI_CHANNEL_2)\b/;
  const measureCommands = /^(M|MR|MX|MY|MZ|MRX|MRY|MRZ)\b/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const command = trimmed.split(/\s+/)[0];

    if (command === 'TICK') {
      // Reset qubit tracking for new tick
      qubitOpsInTick = {};
      // Track if TICK happened after measurement
      if (hasMeasurementSinceLastTick) {
        hadTickSinceMeasurement = true;
      }
      hasMeasurementSinceLastTick = false;
      continue;
    }

    if (command === 'DETECTOR' || command.startsWith('DETECTOR(')) {
      // Check if there was a TICK between measurement and this detector
      if (hadTickSinceMeasurement && !foundDetectorAfterTick) {
        foundDetectorAfterTick = true;
        warnings.push({
          type: 'detector_after_tick',
          message: 'A DETECTOR appears after a TICK following its measurement. This may cause incorrect detecting region visualization. Consider placing DETECTORs immediately after their measurements.'
        });
      }
      hadTickSinceMeasurement = false;
      continue;
    }

    // Check if it's a metadata command (OK between measurement and detector)
    if (metadataCommands.has(command)) continue;

    // Check for measurement
    if (measureCommands.test(trimmed)) {
      hasMeasurementSinceLastTick = true;
      hadTickSinceMeasurement = false; // New measurement resets the warning condition
    }

    // Check for qubit operations and track same-qubit conflicts
    if (qubitCommands.test(trimmed) && !foundMissingTick) {
      // Extract qubits from the command (after the command name, before any parens)
      const parts = trimmed.split(/[\(\)]/)[0].split(/\s+/).slice(1);
      const qubits = parts.filter(p => /^\d+$/.test(p)).map(Number);

      for (const q of qubits) {
        if (qubitOpsInTick[q]) {
          foundMissingTick = true;
          warnings.push({
            type: 'missing_tick',
            message: `Multiple operations on qubit ${q} without a TICK between them. This may cause visualization issues. Add TICK commands between sequential operations on the same qubit.`
          });
          break;
        }
        qubitOpsInTick[q] = command;
      }
    }
  }

  return warnings;
}
