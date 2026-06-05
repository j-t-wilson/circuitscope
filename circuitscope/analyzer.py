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
        self._tick_mapping_cache = None

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
    def detecting_regions(self) -> Dict[str, Dict[int, List[Dict[str, Any]]]]:
        """Lazily compute and cache detecting regions."""
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

    def _compute_detecting_regions(self) -> Dict[str, Dict[int, List[Dict[str, Any]]]]:
        """
        Convert stim detecting_regions output to JSON-serializable format.

        Uses TICK-augmented circuit for high time resolution, then maps back
        to original timeline ticks.

        Returns:
            Dictionary mapping detector names (e.g., "D0") to their detecting regions.
            Each region maps tick indices to lists of qubit sensitivities (X or Z type Paulis).
        """
        try:
            # Get or build TICK-augmented circuit
            if self._tick_augmented_circuit_cache is None:
                augmented, tick_mapping = self._build_tick_augmented_circuit()
                self._tick_augmented_circuit_cache = augmented
                self._tick_mapping_cache = tick_mapping
            else:
                augmented = self._tick_augmented_circuit_cache
                tick_mapping = self._tick_mapping_cache

            # Get detecting regions from augmented circuit (high resolution)
            raw_regions = augmented.detecting_regions(ignore_anticommutation_errors=True)
        except Exception:
            return {}

        result = {}
        for dem_target, tick_sensitivities in raw_regions.items():
            target_str = str(dem_target)
            # Only include detectors (D#), skip observables (L#)
            if not target_str.startswith('D'):
                continue

            # Map augmented ticks back to original timeline ticks
            # and merge sensitivities that map to the same original tick
            original_tick_sensitivities = {}

            for aug_tick, pauli_string in tick_sensitivities.items():
                # Map to original timeline tick
                orig_tick = tick_mapping.get(aug_tick, aug_tick)

                # Initialize set for deduplication
                if orig_tick not in original_tick_sensitivities:
                    original_tick_sensitivities[orig_tick] = set()

                # Extract sensitivities (skip Y-type, only X and Z)
                pauli_str = str(pauli_string)
                sign_offset = 1  # Skip sign character (+/-)

                for qubit_idx in pauli_string.pauli_indices():
                    pauli_char = pauli_str[qubit_idx + sign_offset]
                    if pauli_char in ('X', 'Z'):
                        original_tick_sensitivities[orig_tick].add((qubit_idx, pauli_char))

            # Convert to JSON-serializable format
            detector_regions = {}
            for tick, sensitivities_set in original_tick_sensitivities.items():
                sensitivities_list = [
                    {'qubit': q, 'pauli': p}
                    for q, p in sorted(sensitivities_set)
                ]
                if sensitivities_list:
                    detector_regions[tick] = sensitivities_list

            if detector_regions:
                result[target_str] = detector_regions

        return result

    def _build_tick_augmented_circuit(self) -> Tuple[stim.Circuit, Dict[int, int]]:
        """
        Build a version of the circuit with TICKs after every instruction.

        This provides high time resolution for detecting_regions() analysis.

        Returns:
            Tuple of:
            - augmented_circuit: Circuit with TICK after each non-meta instruction
            - tick_mapping: Dict mapping augmented_tick -> original_timeline_tick
        """
        augmented = stim.Circuit()
        tick_mapping = {}

        original_tick = 0
        augmented_tick = 0

        for inst in self.circuit:  # self.circuit is already flattened
            inst_name = inst.name

            if inst_name == 'TICK':
                # Original TICK: pass through and map ticks
                augmented.append(inst)
                original_tick += 1  # Increment FIRST - TICK marks start of next period
                tick_mapping[augmented_tick] = original_tick  # Then map to NEW tick
                augmented_tick += 1
            elif inst_name in META_INSTRUCTIONS:
                # Meta instructions: no TICK insertion, don't advance ticks
                augmented.append(inst)
            else:
                # Regular instruction: append it, then insert TICK
                augmented.append(inst)
                augmented.append('TICK')
                tick_mapping[augmented_tick] = original_tick
                augmented_tick += 1

        return augmented, tick_mapping

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

    def _build_measurement_record(self) -> List[Dict[str, Any]]:
        """
        Build a list of measurement records in circuit order.

        Each entry contains:
        - tick: which tick the measurement occurred in
        - qubit: which qubit was measured
        - index: the measurement index (for rec[] references)
        """
        measurements = []
        tick = 0

        for inst in self.circuit:
            name = inst.name
            if name == 'TICK':
                tick += 1
                continue

            if name in MEASURE_TYPES:
                for qubit in self._extract_qubits(inst):
                    measurements.append({
                        'tick': tick,
                        'qubit': qubit,
                        'index': len(measurements)
                    })

        return measurements

    def _get_detector_positions(self) -> Dict[int, Dict[str, Any]]:
        """
        Compute detector positions based on their measurement references.

        A detector is positioned at the tick/qubit of its latest referenced measurement,
        matching how Stim positions detectors in circuit.diagram().

        Returns a dict mapping detector ID to {tick, qubit, measurement_indices}.
        measurement_indices is a list of absolute measurement indices that the detector references.
        """
        # Build measurement records as we iterate, since rec[] offsets are relative
        # to the measurement count AT THE TIME the DETECTOR is encountered
        measurements = []
        tick = 0
        positions = {}
        detector_id = 0

        for inst in self.circuit:
            name = inst.name

            if name == 'TICK':
                tick += 1
                continue

            if name in MEASURE_TYPES:
                # Record measurements as we encounter them
                for qubit in self._extract_qubits(inst):
                    measurements.append({
                        'tick': tick,
                        'qubit': qubit,
                        'index': len(measurements)
                    })

            elif name == 'DETECTOR':
                # Parse rec[] references from the detector instruction
                # Offsets are relative to current measurement count
                num_measurements = len(measurements)
                latest_tick = -1
                latest_qubit = 0
                measurement_indices = []

                for t in inst.targets_copy():
                    # Check if this is a measurement record target
                    if hasattr(t, 'is_measurement_record_target') and t.is_measurement_record_target:
                        offset = t.value  # negative offset like -1, -2, -3
                        # Convert relative offset to absolute index
                        abs_idx = num_measurements + offset  # offset is negative
                        if 0 <= abs_idx < num_measurements:
                            meas = measurements[abs_idx]
                            measurement_indices.append(abs_idx)
                            # Track the latest (highest tick) measurement
                            if meas['tick'] > latest_tick:
                                latest_tick = meas['tick']
                                latest_qubit = meas['qubit']
                            elif meas['tick'] == latest_tick:
                                # If same tick, use the qubit (could be arbitrary choice)
                                latest_qubit = meas['qubit']

                positions[detector_id] = {
                    'tick': latest_tick if latest_tick >= 0 else 0,
                    'qubit': latest_qubit,
                    'measurement_indices': measurement_indices
                }
                detector_id += 1

        return positions

    def get_detectors(self) -> List[Dict[str, Any]]:
        """Extract all detector information from the circuit."""
        positions = self._get_detector_positions()
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
                prob = inst.args_copy()[0] if inst.args_copy() else 0.0
                targets = tuple(sorted(str(t) for t in inst.targets_copy()))
                dem_probability_map[targets] = prob

        for exp in self.explanations:
            # Parse DEM terms
            dem_terms = []
            for term in exp.dem_error_terms:
                dem_target = str(term.dem_target)
                dem_terms.append({
                    'target': dem_target
                })

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

            op_type = self._instruction_type(name)
            order = len(current_ops)

            # Handle 2-qubit gates specially (pair them)
            if name in TWO_QUBIT_TYPES and len(qubits) >= 2:
                paired_qubits = [[qubits[i], qubits[i+1]] for i in range(0, len(qubits)-1, 2)]
                current_ops.append({
                    'name': name,
                    'qubits': paired_qubits,
                    'type': op_type,
                    'rate': rate,
                    'order': order,
                    'instruction_index': idx
                })
            else:
                current_ops.append({
                    'name': name,
                    'qubits': qubits,
                    'type': op_type,
                    'rate': rate,
                    'order': order,
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
        # Get detailed budgets which includes event fractions
        detailed_result = self.get_detailed_error_budgets()

        # Get basic detector info
        detectors = self.get_detectors()

        # Add event_fraction to each detector
        for d in detectors:
            det_id = d['id']
            if det_id < len(detailed_result.det_p_dem):
                d['event_fraction'] = detailed_result.det_p_dem[det_id]
            else:
                d['event_fraction'] = 0.0

        # Convert detailed budgets to JSON-serializable format
        # Budget is List[Dict[str, BudgetItem]] indexed by detector ID
        # We want to map it to detector names for easier frontend use
        detailed_budgets: Dict[str, Dict[str, Any]] = {}
        for d in detectors:
            det_id = d['id']
            det_name = d['name']
            if det_id < len(detailed_result.budget):
                budget_dict = detailed_result.budget[det_id]
                detailed_budgets[det_name] = {
                    'event_fraction': detailed_result.det_p_dem[det_id] if det_id < len(detailed_result.det_p_dem) else 0.0,
                    'event_fraction_from_explain': detailed_result.det_p_from_explain[det_id] if det_id < len(detailed_result.det_p_from_explain) else 0.0,
                    'breakdown': {
                        key: {
                            'count': item.count,
                            'sum_p': item.sum_p,
                            'p_if_only_this_group': item.p_if_only_this_group,
                            'log_weight': item.log_weight,
                            'share_of_log_weight': item.share_of_log_weight,
                            'example_locations': list(item.example_locations),
                        }
                        for key, item in budget_dict.items()
                    }
                }

        return {
            'circuit_text': self.get_circuit_text(),
            'num_qubits': self.get_num_qubits(),
            'num_detectors': self.get_num_detectors(),
            'detectors': detectors,
            'detector_errors': self.get_detector_errors(),
            'timeline': self.get_timeline(),
            'measurements': self._build_measurement_record(),
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
