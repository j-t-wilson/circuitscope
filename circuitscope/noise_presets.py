"""
Composable noise sources for clean circuits.

Experimentalists often receive noiseless ("theory team") circuits. This module
inserts independent noise sources into such a circuit so it becomes a noise
model whose rates can then be fitted to measured data. Each source is applied
on its own, so callers compose exactly the model they believe in:

- ``gate2_depolarizing``: DEPOLARIZE2(p) after every two-qubit unitary gate
- ``gate1_depolarizing``: DEPOLARIZE1(p) after every single-qubit unitary gate
- ``reset_flip``: a basis-appropriate flip (X_ERROR / Z_ERROR) after each reset
- ``measure_flip``: a basis-appropriate flip before each measurement
- ``idle_depolarizing``: DEPOLARIZE1(p) on qubits idle during layers that
  contain two-qubit gates (``during="gate2"``), measurements
  (``during="measure"``), or any operation (``during="all"``). Layers are the
  segments between TICKs; REPEAT block boundaries also end a layer.

REPEAT blocks are preserved: noise is inserted inside the loop body once, which
applies it to every iteration (matching the analyzer's flattened semantics).

``strip_noise`` is the inverse housekeeping action: it removes pure noise
channels and drops noise arguments from measurements, so an already-noisy
circuit can be cleanly re-noised with a preset.
"""

from typing import Dict, List, Set, Tuple

import stim


SOURCE_TYPES = (
    "gate2_depolarizing",
    "gate1_depolarizing",
    "reset_flip",
    "measure_flip",
    "idle_depolarizing",
)

IDLE_DURING = ("gate2", "measure", "all")

# Annotations never touch qubits for noise purposes (QUBIT_COORDS has a qubit
# target but performs no operation on it).
_ANNOTATIONS = {"DETECTOR", "OBSERVABLE_INCLUDE", "QUBIT_COORDS", "SHIFT_COORDS", "MPAD", "TICK"}

# Flip channel that anticommutes with the reset/measurement basis. Names are
# stim canonical names (RZ reports as R, MZ as M, ...). Multi-qubit and Pauli
# product measurements (MXX, MPP, ...) are deliberately absent: a single flip
# channel does not model them, so they are skipped.
_RESET_FLIP = {"R": "X_ERROR", "RX": "Z_ERROR", "RY": "X_ERROR",
               "MR": "X_ERROR", "MRX": "Z_ERROR", "MRY": "X_ERROR"}
_MEASURE_FLIP = {"M": "X_ERROR", "MX": "Z_ERROR", "MY": "X_ERROR",
                 "MR": "X_ERROR", "MRX": "Z_ERROR", "MRY": "X_ERROR"}


def _is_pure_noise(gate: "stim.GateData") -> bool:
    # Note stim flags measurements like M as noisy gates too (they accept a
    # noise argument); a pure noise channel is one with no measurement record.
    return gate.is_noisy_gate and not gate.produces_measurements


def validate_sources(sources: List[dict]) -> None:
    """Raise ValueError on a malformed source list."""
    if not isinstance(sources, list):
        raise ValueError("'sources' must be a list")
    for i, src in enumerate(sources):
        if not isinstance(src, dict) or "type" not in src:
            raise ValueError(f"Source {i} must be an object with a 'type'")
        if src["type"] not in SOURCE_TYPES:
            raise ValueError(
                f"Source {i} has unknown type '{src['type']}' (expected one of {', '.join(SOURCE_TYPES)})"
            )
        try:
            p = float(src.get("p", -1))
        except (TypeError, ValueError):
            raise ValueError(f"Source {i} ({src['type']}) has non-numeric probability")
        if not (0 <= p <= 1):
            raise ValueError(f"Source {i} ({src['type']}) probability must be in [0, 1], got {src.get('p')}")
        if src["type"] == "idle_depolarizing" and src.get("during", "gate2") not in IDLE_DURING:
            raise ValueError(
                f"Source {i} idle_depolarizing 'during' must be one of {', '.join(IDLE_DURING)}"
            )


def _collect_used_qubits(block, acc: Set[int]) -> None:
    for inst in block:
        if isinstance(inst, stim.CircuitRepeatBlock):
            _collect_used_qubits(inst.body_copy(), acc)
            continue
        if inst.name in _ANNOTATIONS:
            continue
        for t in inst.targets_copy():
            if t.is_qubit_target:
                acc.add(t.value)


def apply_noise_sources(circuit_text: str, sources: List[dict], strip_existing: bool = False) -> Tuple[str, Dict[str, int]]:
    """
    Insert the given noise sources into the circuit.

    Returns (new_circuit_text, inserted) where inserted counts the noise
    instructions added per source type (instructions inside REPEAT bodies
    count once even though they apply every iteration).
    """
    validate_sources(sources)
    circuit = stim.Circuit(circuit_text)
    if strip_existing:
        circuit = _strip_circuit(circuit)
    active = [dict(src, p=float(src["p"])) for src in sources if float(src["p"]) > 0]
    universe: Set[int] = set()
    _collect_used_qubits(circuit, universe)
    inserted = {src["type"]: 0 for src in active}
    out = stim.Circuit()
    _apply_block(circuit, active, universe, out, inserted)
    return str(out), inserted


def _apply_block(block, sources, universe, out, inserted) -> None:
    # Layer (between-TICK segment) tracking for idle noise
    seg_touched: Set[int] = set()
    seg_kinds: Set[str] = set()

    def flush_layer():
        for src in sources:
            if src["type"] != "idle_depolarizing":
                continue
            during = src.get("during", "gate2")
            triggered = (
                "gate2" in seg_kinds if during == "gate2"
                else "measure" in seg_kinds if during == "measure"
                else bool(seg_kinds)
            )
            if not triggered:
                continue
            idle = sorted(universe - seg_touched)
            if idle:
                out.append("DEPOLARIZE1", idle, src["p"])
                inserted[src["type"]] += 1
        seg_touched.clear()
        seg_kinds.clear()

    for inst in block:
        if isinstance(inst, stim.CircuitRepeatBlock):
            flush_layer()  # the loop boundary ends the current layer
            body = stim.Circuit()
            _apply_block(inst.body_copy(), sources, universe, body, inserted)
            out.append(stim.CircuitRepeatBlock(inst.repeat_count, body))
            continue

        name = inst.name
        if name == "TICK":
            flush_layer()
            out.append(inst)
            continue
        if name in _ANNOTATIONS:
            out.append(inst)
            continue

        gate = stim.gate_data(name)
        targets = inst.targets_copy()
        qubits = [t.value for t in targets if t.is_qubit_target]

        # Measurement flips go before the instruction they corrupt
        if name in _MEASURE_FLIP and qubits:
            for src in sources:
                if src["type"] == "measure_flip":
                    out.append(_MEASURE_FLIP[name], qubits, src["p"])
                    inserted[src["type"]] += 1

        out.append(inst)

        # Layer tracking: pure noise channels don't count as touching a qubit
        if not _is_pure_noise(gate) and qubits:
            seg_touched.update(qubits)
            seg_kinds.add("op")
            if gate.is_unitary and gate.is_two_qubit_gate:
                seg_kinds.add("gate2")
            if gate.produces_measurements:
                seg_kinds.add("measure")

        # Gate noise goes after the instruction
        if gate.is_unitary and gate.is_two_qubit_gate:
            # Keep only pairs where both targets are plain qubits (skips
            # classically-controlled forms like CX rec[-1] 0)
            pair_qubits = []
            for a, b in zip(targets[::2], targets[1::2]):
                if a.is_qubit_target and b.is_qubit_target:
                    pair_qubits.extend([a.value, b.value])
            if pair_qubits:
                for src in sources:
                    if src["type"] == "gate2_depolarizing":
                        out.append("DEPOLARIZE2", pair_qubits, src["p"])
                        inserted[src["type"]] += 1
        elif gate.is_unitary and gate.is_single_qubit_gate and qubits:
            for src in sources:
                if src["type"] == "gate1_depolarizing":
                    out.append("DEPOLARIZE1", qubits, src["p"])
                    inserted[src["type"]] += 1

        if name in _RESET_FLIP and qubits:
            for src in sources:
                if src["type"] == "reset_flip":
                    out.append(_RESET_FLIP[name], qubits, src["p"])
                    inserted[src["type"]] += 1

    flush_layer()


def strip_noise(circuit_text: str) -> str:
    """Remove noise from a circuit: pure noise channels are dropped, and noise
    arguments on measurements (e.g. M(0.01)) are removed. Noisy gates that
    produce measurement records (e.g. HERALDED_ERASE) are kept untouched,
    since removing them would shift the measurement record."""
    return str(_strip_circuit(stim.Circuit(circuit_text)))


def _strip_circuit(circuit: "stim.Circuit") -> "stim.Circuit":
    out = stim.Circuit()
    _strip_block(circuit, out)
    return out


def _strip_block(block, out) -> None:
    for inst in block:
        if isinstance(inst, stim.CircuitRepeatBlock):
            body = stim.Circuit()
            _strip_block(inst.body_copy(), body)
            out.append(stim.CircuitRepeatBlock(inst.repeat_count, body))
            continue
        gate = stim.gate_data(inst.name)
        if _is_pure_noise(gate):
            continue
        # Strip noise args from measurements when the arg is optional; gates
        # that require their argument (e.g. HERALDED_ERASE) are kept intact.
        if gate.produces_measurements and inst.gate_args_copy() and 0 in gate.num_parens_arguments_range:
            out.append(inst.name, inst.targets_copy(), [])
            continue
        out.append(inst)
