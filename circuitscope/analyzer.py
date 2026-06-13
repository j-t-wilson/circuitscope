#!/usr/bin/env python3
"""
CircuitScope Analyzer
=====================
Processes stim quantum error correction circuits and exports data for visualization.

This module provides functions to:
1. Parse stim circuits into JSON-serializable structures
2. Extract detector error model explanations
3. Build error budgets with detailed per-detector breakdowns
4. Generate timeline data for circuit visualization
"""

import stim
from typing import List, Dict, Any, Tuple

from .event_fraction_utils import (
    detector_event_fractions_from_dem,
    detector_error_budgets_from_explain,
    DetectorBudgetResult,
    BudgetItem,
)

# Circuit instruction type sets (used for classification)
MEASURE_TYPES = frozenset({'M', 'MR', 'MX', 'MY', 'MZ', 'MRX', 'MRY', 'MRZ'})
ERROR_TYPES = frozenset({'DEPOLARIZE1', 'DEPOLARIZE2', 'X_ERROR', 'Y_ERROR', 'Z_ERROR',
                         'PAULI_CHANNEL_1', 'PAULI_CHANNEL_2'})
GATE_TYPES = frozenset({'CX', 'CZ', 'CY', 'CNOT', 'SWAP', 'ISWAP', 'XCX', 'H', 'S', 'T',
                        'X', 'Y', 'Z', 'SQRT_X', 'SQRT_Y', 'SQRT_Z'})
INIT_TYPES = frozenset({'R', 'RX', 'RY', 'RZ'})
META_INSTRUCTIONS = frozenset({'DETECTOR', 'OBSERVABLE_INCLUDE', 'SHIFT_COORDS', 'QUBIT_COORDS'})
TWO_QUBIT_TYPES = frozenset({'CX', 'CZ', 'CY', 'CNOT', 'SWAP', 'ISWAP', 'XCX'})


class CircuitScopeAnalyzer:
    """
    Analyzes stim circuits for error correction visualization.

    This class extracts all relevant information from a stim circuit
    and prepares it for interactive visualization in the CircuitScope frontend.
    """

    def __init__(self, circuit: stim.Circuit):
        self._original_circuit = circuit  # Store original for circuit_text display
        self.circuit = circuit.flattened()  # Use flattened for all analysis
        self._dem_cache = None
        self._explanations_cache = None
        self._detecting_regions_cache = None
        self._tick_augmented_circuit_cache = None
        self._region_instants_cache = None
        self._circuit_scan_cache = None

    @property
    def dem(self) -> stim.DetectorErrorModel:
        """Lazily compute and cache the detector error model."""
        if self._dem_cache is None:
            self._dem_cache = self.circuit.detector_error_model()
        return self._dem_cache

    @property
    def explanations(self) -> List[stim.ExplainedError]:
        """Lazily compute and cache error explanations."""
        if self._explanations_cache is None:
            self._explanations_cache = self.circuit.explain_detector_error_model_errors()
        return self._explanations_cache

    @property
    def detecting_regions(self) -> Dict[str, List[Dict[str, Any]]]:
        """Lazily compute and cache detecting-region segments."""
        if self._detecting_regions_cache is None:
            self._detecting_regions_cache = self._compute_detecting_regions()
        return self._detecting_regions_cache

    def get_circuit_text(self) -> str:
        """Return the original circuit as a string (with REPEAT blocks if present)."""
        return str(self._original_circuit)

    def get_num_qubits(self) -> int:
        """Return the number of qubits in the circuit."""
        return self.circuit.num_qubits

    def get_num_detectors(self) -> int:
        """Return the number of detectors in the circuit."""
        return self.circuit.num_detectors

    @staticmethod
    def _extract_qubits(inst) -> List[int]:
        """Extract qubit indices from a stim instruction's targets."""
        return [
            int(target.value)
            for target in inst.targets_copy()
            if getattr(target, 'is_qubit_target', False)
        ]

    def _compute_detecting_regions(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        Compute detecting-region segments per detector.

        Uses a TICK-augmented circuit (a TICK after every instruction) so the
        sensitivity Pauli is known between every pair of instructions, then
        merges consecutive instants with the same Pauli into segments.

        Returns:
            Dictionary mapping detector names (e.g., "D0") to lists of segments
            {qubit, pauli, start, end}. ``start``/``end`` are {tick, order}
            positions in the timeline: a segment begins at the instruction that
            created the sensitivity and ends at the instruction that changed or
            consumed it. ``order: None`` marks a tick boundary (a sensitivity
            already present when the circuit starts with a TICK); ``end: None``
            means the sensitivity survives to the end of the circuit. Paulis
            are X, Y, or Z (Y means the detector is flipped by both X- and
            Z-type errors on that qubit).
        """
        try:
            if self._tick_augmented_circuit_cache is None:
                self._tick_augmented_circuit_cache, self._region_instants_cache = \
                    self._build_tick_augmented_circuit()
            instants = self._region_instants_cache

            # Get detecting regions from augmented circuit (high resolution)
            raw_regions = self._tick_augmented_circuit_cache.detecting_regions(
                ignore_anticommutation_errors=True)
        except Exception:
            return {}

        num_instants = len(instants)
        result = {}
        for dem_target, tick_sensitivities in raw_regions.items():
            target_str = str(dem_target)
            # Only include detectors (D#), skip observables (L#)
            if not target_str.startswith('D'):
                continue

            # Per-qubit sensitivity at each instant (instant i = the moment
            # right after the instruction described by instants[i])
            per_qubit: Dict[int, Dict[int, str]] = {}
            for aug_tick, pauli_string in tick_sensitivities.items():
                if aug_tick >= num_instants:
                    continue
                pauli_str = str(pauli_string)
                for qubit_idx in pauli_string.pauli_indices():
                    pauli_char = pauli_str[qubit_idx + 1]  # +1 skips the sign character
                    per_qubit.setdefault(qubit_idx, {})[aug_tick] = pauli_char

            # Merge runs of identical sensitivity into segments. Sensitivity
            # only changes across an instruction, so run edges always land on
            # instruction instants (never plain tick boundaries).
            segments = []
            for qubit_idx in sorted(per_qubit):
                by_instant = per_qubit[qubit_idx]
                run_pauli = None
                run_start = 0
                for i in range(num_instants + 1):
                    pauli = by_instant.get(i)
                    if pauli == run_pauli:
                        continue
                    if run_pauli is not None:
                        segments.append({
                            'qubit': qubit_idx,
                            'pauli': run_pauli,
                            'start': instants[run_start],
                            'end': instants[i] if i < num_instants else None,
                        })
                    run_pauli = pauli
                    run_start = i

            if segments:
                result[target_str] = segments

        return result

    def _build_tick_augmented_circuit(self) -> Tuple[stim.Circuit, List[Dict[str, Any]]]:
        """
        Build a version of the circuit with TICKs after every instruction.

        This provides high time resolution for detecting_regions() analysis.

        Returns:
            Tuple of:
            - augmented_circuit: Circuit with TICK after each non-meta instruction
            - instants: instants[augmented_tick] = {tick, order} timeline position
              of the instruction that augmented tick follows; ``order`` matches
              the op order in get_timeline(). Original TICKs produce a boundary
              instant {tick: <new tick>, order: None}.
        """
        augmented = stim.Circuit()
        instants: List[Dict[str, Any]] = []

        tick = 0
        order = 0

        for inst in self.circuit:  # self.circuit is already flattened
            inst_name = inst.name

            if inst_name == 'TICK':
                # Original TICK: a boundary instant at the start of the next tick
                augmented.append(inst)
                tick += 1
                order = 0
                instants.append({'tick': tick, 'order': None})
            elif inst_name in META_INSTRUCTIONS:
                # Meta instructions: no TICK insertion, don't advance instants
                augmented.append(inst)
            else:
                # Regular instruction: append it, then insert TICK
                augmented.append(inst)
                augmented.append('TICK')
                instants.append({'tick': tick, 'order': order})
                order += 1

        return augmented, instants

    @staticmethod
    def _format_pauli_product(flipped_pauli_product) -> str:
        """Format a Stim Pauli product as X0, Z2, X0*Z2, etc."""
        parts = []
        for target in flipped_pauli_product:
            gate_target = target.gate_target
            if gate_target.is_x_target:
                pauli = 'X'
            elif gate_target.is_y_target:
                pauli = 'Y'
            elif gate_target.is_z_target:
                pauli = 'Z'
            else:
                parts.append(str(gate_target))
                continue
            parts.append(f"{pauli}{gate_target.value}")
        return "*".join(parts) if parts else "NO_PAULI"

    @staticmethod
    def _instruction_details_from_location(loc) -> Tuple[str, float, List[int]]:
        """Extract instruction name, first probability argument, and qubits from a Stim location."""
        instruction_targets = loc.instruction_targets
        name = instruction_targets.gate or "UNKNOWN"
        args = list(instruction_targets.args)
        rate = float(args[0]) if args else 0.0
        qubits = [
            int(target.gate_target.value)
            for target in instruction_targets.targets_in_range
            if getattr(target.gate_target, 'is_qubit_target', False)
        ]
        return name, rate, qubits

    @staticmethod
    def _instruction_type(name: str) -> str:
        """Classify a circuit instruction for timeline rendering."""
        if name in ERROR_TYPES:
            return 'error'
        if name in MEASURE_TYPES:
            return 'measure'
        if name in INIT_TYPES:
            return 'init'
        if name in GATE_TYPES:
            return 'gate'
        return 'other'

    def _scan_circuit(self) -> Tuple[List[Dict[str, Any]], Dict[int, Dict[str, Any]]]:
        """
        Walk the circuit once, recording measurements and detector positions.

        Both records are built in the same pass because a DETECTOR's rec[]
        offsets are relative to the measurement count at the point the
        DETECTOR appears.

        Returns:
            Tuple of:
            - measurements: List of {tick, qubit, index} in circuit order
            - positions: Dict mapping detector ID to {tick, qubit, measurement_indices},
              where the position is the tick/qubit of the detector's latest referenced
              measurement (matching how Stim positions detectors in circuit.diagram())
        """
        measurements: List[Dict[str, Any]] = []
        positions: Dict[int, Dict[str, Any]] = {}
        tick = 0

        for inst in self.circuit:
            name = inst.name

            if name == 'TICK':
                tick += 1

            elif name in MEASURE_TYPES:
                for qubit in self._extract_qubits(inst):
                    measurements.append({
                        'tick': tick,
                        'qubit': qubit,
                        'index': len(measurements)
                    })

            elif name == 'DETECTOR':
                latest = None
                measurement_indices = []
                for t in inst.targets_copy():
                    if getattr(t, 'is_measurement_record_target', False):
                        abs_idx = len(measurements) + t.value  # t.value is a negative offset
                        if 0 <= abs_idx < len(measurements):
                            measurement_indices.append(abs_idx)
                            meas = measurements[abs_idx]
                            if latest is None or meas['tick'] >= latest['tick']:
                                latest = meas

                positions[len(positions)] = {
                    'tick': latest['tick'] if latest else 0,
                    'qubit': latest['qubit'] if latest else 0,
                    'measurement_indices': measurement_indices
                }

        return measurements, positions

    @property
    def _circuit_scan(self) -> Tuple[List[Dict[str, Any]], Dict[int, Dict[str, Any]]]:
        """Lazily compute and cache the (measurements, detector positions) scan."""
        if self._circuit_scan_cache is None:
            self._circuit_scan_cache = self._scan_circuit()
        return self._circuit_scan_cache

    def get_measurements(self) -> List[Dict[str, Any]]:
        """Return measurement records ({tick, qubit, index}) in circuit order."""
        return self._circuit_scan[0]

    def get_detectors(self) -> List[Dict[str, Any]]:
        """Extract all detector information from the circuit."""
        positions = self._circuit_scan[1]
        detectors = []

        for det_id in range(self.get_num_detectors()):
            pos = positions.get(det_id, {'tick': 0, 'qubit': 0, 'measurement_indices': []})
            detectors.append({
                'id': det_id,
                'name': f'D{det_id}',
                'tick': pos['tick'],
                'qubit': pos['qubit'],
                'measurement_indices': pos.get('measurement_indices', []),
            })

        return detectors

    def get_detector_errors(self) -> List[Dict[str, Any]]:
        """
        Extract all detector error mechanisms with their circuit locations.

        Returns a list of error mechanisms, each containing:
        - dem_terms: Which detectors/observables are affected
        - locations: Where in the circuit this error can occur
        - probability: The actual DEM probability for this error mechanism
        """
        errors = []
        instruction_index_map = self._build_instruction_index_map()

        # Build a map from (sorted targets tuple) -> probability from the DEM
        dem_probability_map = {}
        for inst in self.dem:
            if inst.type == "error":
                args = inst.args_copy()
                targets = tuple(sorted(str(t) for t in inst.targets_copy()))
                dem_probability_map[targets] = float(args[0]) if args else 0.0

        for exp in self.explanations:
            dem_terms = [{'target': str(term.dem_target)} for term in exp.dem_error_terms]

            # Parse circuit error locations
            locations = []
            for loc in exp.circuit_error_locations:
                pauli_str = self._format_pauli_product(loc.flipped_pauli_product)
                inst_str = str(loc.instruction_targets)
                inst_name, error_rate, qubits = self._instruction_details_from_location(loc)

                # Try to find instruction index
                inst_idx = instruction_index_map.get(
                    (loc.tick_offset, inst_name, tuple(qubits)), -1
                )

                locations.append({
                    'pauli': pauli_str,
                    'tick_offset': loc.tick_offset,
                    'instruction': inst_str,
                    'instruction_name': inst_name,
                    'instruction_index': inst_idx,
                    'error_rate': error_rate,
                    'qubits': qubits
                })

            # Look up the actual probability from the DEM
            targets_key = tuple(sorted(term['target'] for term in dem_terms))
            probability = dem_probability_map.get(targets_key, 0.0)

            errors.append({
                'dem_terms': dem_terms,
                'locations': locations,
                'probability': probability
            })

        return errors

    def _build_instruction_index_map(self) -> Dict[Tuple, int]:
        """Build a map from (tick, name, qubits) to instruction index."""
        index_map = {}
        tick = 0

        for idx, inst in enumerate(self.circuit):
            name = inst.name

            if name == 'TICK':
                tick += 1
                continue

            qubits = self._extract_qubits(inst)
            index_map[(tick, name, tuple(qubits))] = idx

        return index_map

    def get_timeline(self) -> List[Dict[str, Any]]:
        """
        Build a timeline representation of the circuit.

        Organizes operations by tick for visualization.
        """
        timeline = []
        current_tick = 0
        current_ops = []

        for idx, inst in enumerate(self.circuit):
            name = inst.name

            if name == 'TICK':
                if current_ops:
                    timeline.append({
                        'tick': current_tick,
                        'ops': current_ops
                    })
                current_tick += 1
                current_ops = []
                continue

            if name in META_INSTRUCTIONS:
                continue

            qubits = self._extract_qubits(inst)

            # Get error rate if applicable
            rate = None
            if hasattr(inst, 'gate_args_copy'):
                args = list(inst.gate_args_copy())
                if args:
                    rate = args[0]

            # 2-qubit gates render as pairs
            if name in TWO_QUBIT_TYPES and len(qubits) >= 2:
                qubits = [[qubits[i], qubits[i+1]] for i in range(0, len(qubits)-1, 2)]

            current_ops.append({
                'name': name,
                'qubits': qubits,
                'type': self._instruction_type(name),
                'rate': rate,
                'order': len(current_ops),
                'instruction_index': idx
            })

        # Don't forget the last tick
        if current_ops:
            timeline.append({
                'tick': current_tick,
                'ops': current_ops
            })

        return timeline

    def get_detector_event_fractions(self) -> List[float]:
        """
        Compute analytical detector event fractions from the DEM.

        For each detector, this combines all independent error(p) terms that toggle it
        via the formula: 0.5 * (1 - Π(1-2p))

        Returns a list of probabilities indexed by detector ID.
        """
        dem_kwargs = dict(flatten_loops=True, approximate_disjoint_errors=True)
        return detector_event_fractions_from_dem(self.circuit, dem_kwargs=dem_kwargs)

    def get_detailed_error_budgets(self) -> DetectorBudgetResult:
        """
        Compute detailed error budgets for each detector using explain_detector_error_model_errors.

        For each detector, this breaks down which error mechanisms contribute to its
        firing probability and by how much, using log-weight shares for accurate attribution.

        Returns a DetectorBudgetResult containing:
        - det_p_dem: DEM-derived detector event fractions
        - det_p_from_explain: Reconstructed from explain (should match DEM-derived)
        - budget: Per-detector mapping of group_key -> BudgetItem
        """
        dem_kwargs = dict(flatten_loops=True, approximate_disjoint_errors=True)
        return detector_error_budgets_from_explain(self.circuit, dem_kwargs=dem_kwargs)

    def export_json(self) -> Dict[str, Any]:
        """Export all analysis data as a JSON-serializable dictionary."""
        detailed_result = self.get_detailed_error_budgets()

        def at(values: List[float], index: int) -> float:
            # Detectors are enumerated from the circuit detector count; ones with
            # no error mechanisms may fall outside the DEM-derived lists.
            return values[index] if index < len(values) else 0.0

        detectors = self.get_detectors()
        for d in detectors:
            d['event_fraction'] = at(detailed_result.det_p_dem, d['id'])

        # Map budgets (indexed by detector ID) to detector names for the frontend
        detailed_budgets: Dict[str, Dict[str, Any]] = {}
        for d in detectors:
            det_id = d['id']
            if det_id >= len(detailed_result.budget):
                continue
            detailed_budgets[d['name']] = {
                'event_fraction': at(detailed_result.det_p_dem, det_id),
                'event_fraction_from_explain': at(detailed_result.det_p_from_explain, det_id),
                'breakdown': {
                    key: {
                        'count': item.count,
                        'sum_p': item.sum_p,
                        'p_if_only_this_group': item.p_if_only_this_group,
                        'log_weight': item.log_weight,
                        'share_of_log_weight': item.share_of_log_weight,
                        'example_locations': list(item.example_locations),
                    }
                    for key, item in detailed_result.budget[det_id].items()
                }
            }

        return {
            'circuit_text': self.get_circuit_text(),
            'num_qubits': self.get_num_qubits(),
            'num_detectors': self.get_num_detectors(),
            'detectors': detectors,
            'detector_errors': self.get_detector_errors(),
            'timeline': self.get_timeline(),
            'measurements': self.get_measurements(),
            'detailed_budgets': detailed_budgets,
            'detecting_regions': self.detecting_regions,
        }


def create_sample_circuit(distance: int = 3, rounds: int = 2) -> stim.Circuit:
    """Create a sample repetition code circuit for testing."""
    return stim.Circuit.generated(
        "repetition_code:memory",
        rounds=rounds,
        distance=distance,
        after_reset_flip_probability=0.001,
        before_measure_flip_probability=0.01,
        after_clifford_depolarization=0.005
    )


def analyze_circuit_text(circuit_text: str) -> Dict[str, Any]:
    """Analyze a circuit from its text representation."""
    circuit = stim.Circuit(circuit_text)
    analyzer = CircuitScopeAnalyzer(circuit)
    return analyzer.export_json()
