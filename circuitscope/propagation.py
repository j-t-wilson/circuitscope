#!/usr/bin/env python3
"""
Pauli error propagation
=======================
Propagates a single Pauli error forward through a circuit, tick by tick,
recording the error's frame at each tick boundary plus which measurements
(and therefore detectors) it flips. Powers the timeline's error-propagation
overlay via POST /api/propagate.

The frame semantics match a Pauli frame simulator:
- Unitary gates conjugate the frame (via stim tableaus).
- Resets discard the frame on the reset qubits.
- A measurement is flipped iff the frame anticommutes with the measured
  Pauli (an odd number of anticommuting terms for product measurements).
- Noise channels have no effect on the frame.

Recorded frames: ``frames[start_tick]`` is the freshly injected Pauli, and
``frames[t]`` for ``t > start_tick`` is the frame entering tick ``t`` (the
state at the preceding TICK boundary). Recording stops once the frame is
fully absorbed by resets.
"""

import re
from typing import Any, Dict, List, Optional

import stim

_PAULI_TERM_RE = re.compile(r'([XYZ])(\d+)')
_PAULI_INT = {'X': 1, 'Y': 2, 'Z': 3}
_INT_PAULI = {1: 'X', 2: 'Y', 3: 'Z'}

# Measurement records that a Pauli frame cannot flip (heralds and padding)
_FRAME_IMMUNE_RECORDS = frozenset({
    'HERALDED_ERASE', 'HERALDED_PAULI_CHANNEL_1', 'MPAD',
})


def _gate_data(name: str) -> Optional[stim.GateData]:
    """gate_data for circuit instructions, None for meta (DETECTOR etc.)."""
    try:
        return stim.gate_data(name)
    except Exception:
        return None


def parse_pauli_product(pauli: str) -> Dict[int, int]:
    """Parse a Pauli product like 'X0' or 'X0*Z2' into {qubit: pauli_int}."""
    terms = _PAULI_TERM_RE.findall(pauli or '')
    if not terms:
        raise ValueError(f"No Pauli terms found in {pauli!r}")
    out: Dict[int, int] = {}
    for p, q in terms:
        qubit = int(q)
        if qubit in out:
            raise ValueError(f"Duplicate qubit {qubit} in Pauli product {pauli!r}")
        out[qubit] = _PAULI_INT[p]
    return out


def _frame_terms(frame: stim.PauliString) -> List[Dict[str, Any]]:
    """JSON terms ({qubit, pauli}) for the non-identity entries of a frame."""
    return [
        {'qubit': q, 'pauli': _INT_PAULI[frame[q]]}
        for q in frame.pauli_indices()
    ]


def _measurement_basis(name: str) -> int:
    """Measurement basis (as a pauli int) from a gate name like M, MRX, MZZ."""
    basis = name[-1]
    return _PAULI_INT.get(basis, _PAULI_INT['Z'])


def _measurement_flips(inst, frame: stim.PauliString, meas_index: int) -> List[int]:
    """Indices of this instruction's measurements flipped by the frame."""
    basis = _measurement_basis(inst.name)
    flipped = []
    for offset, group in enumerate(inst.target_groups()):
        anticommutes = 0
        for t in group:
            if t.is_x_target:
                pauli = _PAULI_INT['X']
            elif t.is_y_target:
                pauli = _PAULI_INT['Y']
            elif t.is_z_target:
                pauli = _PAULI_INT['Z']
            elif t.is_qubit_target:
                pauli = basis
            else:
                continue
            if frame[t.value] not in (0, pauli):
                anticommutes += 1
        if anticommutes % 2 == 1:
            flipped.append(meas_index + offset)
    return flipped


def _detector_measurement_indices(circuit: stim.Circuit) -> List[List[int]]:
    """Absolute measurement indices referenced by each detector, in order."""
    detectors: List[List[int]] = []
    meas_count = 0
    for inst in circuit:
        if inst.name == 'DETECTOR':
            indices = [
                meas_count + t.value
                for t in inst.targets_copy()
                if getattr(t, 'is_measurement_record_target', False)
            ]
            detectors.append([i for i in indices if i >= 0])
            continue
        gd = _gate_data(inst.name)
        if gd is not None and gd.produces_measurements:
            meas_count += inst.num_measurements
    return detectors


def _find_injection_index(circuit: stim.Circuit, tick: int, name: str,
                          qubits: List[int]) -> int:
    """Index of the error instruction at `tick` covering `qubits`."""
    wanted = set(qubits)
    cur_tick = 0
    for idx, inst in enumerate(circuit):
        if inst.name == 'TICK':
            cur_tick += 1
            if cur_tick > tick:
                break
            continue
        if cur_tick == tick and inst.name == name:
            targets = {t.value for t in inst.targets_copy() if t.is_qubit_target}
            if wanted <= targets:
                return idx
    raise ValueError(
        f"No {name} instruction on qubits {sorted(wanted)} at tick {tick}"
    )


def propagate_pauli(circuit_text: str, tick: int, name: str,
                    qubits: List[int], pauli: str) -> Dict[str, Any]:
    """
    Propagate one Pauli component of an error channel through the circuit.

    Args:
        circuit_text: The Stim circuit (REPEAT blocks are flattened, matching
            the analyzer's timeline tick indices).
        tick: Timeline tick of the error instruction.
        name: Error instruction name (e.g. DEPOLARIZE1, X_ERROR).
        qubits: Qubits of the specific channel instance clicked (used to
            resolve the instruction when one instruction covers many qubits).
        pauli: The flipped Pauli product to inject, e.g. 'X0' or 'X0*X1'.

    Returns:
        {
            'start_tick': int,
            'frames': {tick: [{'qubit': int, 'pauli': 'X'|'Y'|'Z'}]},
            'flipped_measurements': [int],
            'flipped_detectors': [int],
        }
    """
    circuit = stim.Circuit(circuit_text).flattened()
    pauli_map = parse_pauli_product(pauli)
    num_qubits = max(circuit.num_qubits, max(pauli_map) + 1)
    injection_idx = _find_injection_index(
        circuit, tick, name, qubits or sorted(pauli_map))

    frame = stim.PauliString(num_qubits)
    for q, p in pauli_map.items():
        frame[q] = p

    frames: Dict[int, List[Dict[str, Any]]] = {tick: _frame_terms(frame)}
    flipped_measurements: List[int] = []
    cur_tick = 0
    meas_index = 0
    injected = False

    for idx, inst in enumerate(circuit):
        inst_name = inst.name
        if inst_name == 'TICK':
            cur_tick += 1
            if injected:
                frames[cur_tick] = _frame_terms(frame)
            continue
        if idx == injection_idx:
            injected = True
            continue

        gd = _gate_data(inst_name)
        produces = gd is not None and gd.produces_measurements

        if not injected:
            if produces:
                meas_index += inst.num_measurements
            continue

        if gd is not None and gd.is_unitary:
            frame = frame.after(inst)
            continue

        if produces:
            if inst_name not in _FRAME_IMMUNE_RECORDS:
                flipped_measurements.extend(
                    _measurement_flips(inst, frame, meas_index))
            meas_index += inst.num_measurements

        if gd is not None and gd.is_reset:
            for t in inst.targets_copy():
                if t.is_qubit_target:
                    frame[t.value] = 0
            if frame.weight == 0:
                # Fully absorbed: no later measurement can flip
                break

    flipped_set = set(flipped_measurements)
    flipped_detectors = [
        det_id
        for det_id, indices in enumerate(_detector_measurement_indices(circuit))
        if len(flipped_set.intersection(indices)) % 2 == 1
    ]

    return {
        'start_tick': tick,
        'frames': {t: terms for t, terms in frames.items() if terms},
        'flipped_measurements': sorted(flipped_set),
        'flipped_detectors': flipped_detectors,
    }
