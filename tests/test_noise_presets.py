"""Tests for composable noise source insertion and noise stripping."""

import stim
import pytest

from circuitscope.noise_presets import apply_noise_sources, strip_noise, validate_sources


CLEAN_REP_CODE = """
R 0 1 2 3 4
TICK
CX 0 1 2 3
TICK
CX 2 1 4 3
TICK
M 1 3
DETECTOR(1, 0) rec[-2]
DETECTOR(3, 0) rec[-1]
REPEAT 3 {
    TICK
    R 1 3
    TICK
    CX 0 1 2 3
    TICK
    CX 2 1 4 3
    TICK
    M 1 3
    SHIFT_COORDS(0, 1)
    DETECTOR(1, 0) rec[-2] rec[-4]
    DETECTOR(3, 0) rec[-1] rec[-3]
}
TICK
M 0 2 4
DETECTOR(1, 1) rec[-2] rec[-3] rec[-5]
DETECTOR(3, 1) rec[-1] rec[-2] rec[-4]
OBSERVABLE_INCLUDE(0) rec[-1]
""".strip()


def _instruction_names(circuit):
    """All instruction names, flattening REPEAT blocks structurally (once)."""
    names = []
    for inst in circuit:
        if isinstance(inst, stim.CircuitRepeatBlock):
            names.extend(("REPEAT", _instruction_names(inst.body_copy())))
        else:
            names.append(inst.name)
    return names


def test_gate2_depolarizing_follows_every_2q_gate():
    text, inserted = apply_noise_sources(CLEAN_REP_CODE, [{"type": "gate2_depolarizing", "p": 0.005}])
    circuit = stim.Circuit(text)

    def check_block(block):
        insts = [i for i in block]
        for idx, inst in enumerate(insts):
            if isinstance(inst, stim.CircuitRepeatBlock):
                check_block(inst.body_copy())
                continue
            if inst.name == "CX":
                follower = insts[idx + 1]
                assert follower.name == "DEPOLARIZE2"
                assert follower.gate_args_copy() == [0.005]
                assert [t.value for t in follower.targets_copy()] == [t.value for t in inst.targets_copy()]

    check_block(circuit)
    assert inserted == {"gate2_depolarizing": 4}  # 2 outside + 2 inside the loop
    # REPEAT structure preserved
    assert "REPEAT 3" in text


def test_measure_flip_precedes_measurements_and_reset_flip_follows_resets():
    text, inserted = apply_noise_sources(
        CLEAN_REP_CODE,
        [{"type": "measure_flip", "p": 0.01}, {"type": "reset_flip", "p": 0.002}],
    )
    lines = [l.strip() for l in text.splitlines()]
    for i, line in enumerate(lines):
        if line.startswith("M "):
            assert lines[i - 1].startswith("X_ERROR(0.01)")
        if line.startswith("R "):
            assert lines[i + 1].startswith("X_ERROR(0.002)")
    assert inserted == {"measure_flip": 3, "reset_flip": 2}


def test_basis_aware_flips():
    text, _ = apply_noise_sources(
        "RX 0\nTICK\nMX 0",
        [{"type": "measure_flip", "p": 0.01}, {"type": "reset_flip", "p": 0.002}],
    )
    lines = [l.strip() for l in text.splitlines()]
    assert lines == ["RX 0", "Z_ERROR(0.002) 0", "TICK", "Z_ERROR(0.01) 0", "MX 0"]


def test_idle_depolarizing_during_2q_layers():
    circuit = "R 0 1 2\nTICK\nCX 0 1\nTICK\nH 0\nTICK\nM 0 1 2"
    text, inserted = apply_noise_sources(
        circuit, [{"type": "idle_depolarizing", "p": 0.001, "during": "gate2"}]
    )
    lines = [l.strip() for l in text.splitlines()]
    # Only the CX layer gets idle noise, on the untouched qubit 2
    assert "DEPOLARIZE1(0.001) 2" in lines
    assert lines.count("DEPOLARIZE1(0.001) 2") == 1
    assert lines.index("DEPOLARIZE1(0.001) 2") == lines.index("CX 0 1") + 1
    assert inserted == {"idle_depolarizing": 1}


def test_idle_depolarizing_during_measurement_layers():
    circuit = "R 0 1 2\nTICK\nCX 0 1\nTICK\nM 0 1"
    text, _ = apply_noise_sources(
        circuit, [{"type": "idle_depolarizing", "p": 0.003, "during": "measure"}]
    )
    lines = [l.strip() for l in text.splitlines()]
    assert lines[-1] == "DEPOLARIZE1(0.003) 2"
    assert "DEPOLARIZE1(0.003)" not in "\n".join(lines[:-1])


def test_idle_universe_uses_only_qubits_that_appear():
    # Qubit indices 0 and 4 are used; 1-3 are not real qubits in this circuit
    # and must not receive idle noise.
    circuit = "R 0 4\nTICK\nCX 0 4\nTICK\nM 0"
    text, _ = apply_noise_sources(
        circuit, [{"type": "idle_depolarizing", "p": 0.001, "during": "all"}]
    )
    assert "DEPOLARIZE1(0.001) 4" in text  # idle during the M layer
    for bogus in ("DEPOLARIZE1(0.001) 1", "DEPOLARIZE1(0.001) 2", "DEPOLARIZE1(0.001) 3"):
        assert bogus not in text


def test_gate1_depolarizing_only_hits_1q_unitaries():
    circuit = "R 0 1\nTICK\nH 0\nCX 0 1\nTICK\nM 0 1"
    text, inserted = apply_noise_sources(circuit, [{"type": "gate1_depolarizing", "p": 0.0005}])
    lines = [l.strip() for l in text.splitlines()]
    assert lines[lines.index("H 0") + 1] == "DEPOLARIZE1(0.0005) 0"
    assert inserted == {"gate1_depolarizing": 1}


def test_classically_controlled_2q_gates_are_skipped():
    circuit = "R 0\nTICK\nM 0\nCX rec[-1] 0"
    text, inserted = apply_noise_sources(circuit, [{"type": "gate2_depolarizing", "p": 0.005}])
    assert "DEPOLARIZE2" not in text
    assert inserted == {"gate2_depolarizing": 0}


def test_strip_noise_removes_channels_and_measurement_args():
    noisy = "\n".join([
        "R 0 1",
        "X_ERROR(0.001) 0 1",
        "TICK",
        "CX 0 1",
        "DEPOLARIZE2(0.005) 0 1",
        "TICK",
        "M(0.01) 0",
        "X_ERROR(0.01) 1",
        "M 1",
        "DETECTOR(0, 0) rec[-2]",
    ])
    stripped = stim.Circuit(strip_noise(noisy))
    names = _instruction_names(stripped)
    assert "X_ERROR" not in names and "DEPOLARIZE2" not in names
    # M(0.01) became a clean M; detector structure intact
    m_insts = [i for i in stripped if not isinstance(i, stim.CircuitRepeatBlock) and i.name == "M"]
    assert all(i.gate_args_copy() == [] for i in m_insts)
    assert stripped.num_detectors == 1


def test_apply_then_strip_round_trips_to_the_clean_circuit():
    text, _ = apply_noise_sources(
        CLEAN_REP_CODE,
        [
            {"type": "gate2_depolarizing", "p": 0.005},
            {"type": "measure_flip", "p": 0.01},
            {"type": "reset_flip", "p": 0.001},
            {"type": "idle_depolarizing", "p": 0.0002, "during": "all"},
        ],
    )
    assert stim.Circuit(strip_noise(text)) == stim.Circuit(CLEAN_REP_CODE)


def test_noise_insertion_preserves_detector_structure():
    clean = stim.Circuit(CLEAN_REP_CODE)
    text, _ = apply_noise_sources(
        CLEAN_REP_CODE,
        [{"type": "gate2_depolarizing", "p": 0.005}, {"type": "measure_flip", "p": 0.01}],
    )
    noisy = stim.Circuit(text)
    assert noisy.num_detectors == clean.num_detectors
    assert noisy.num_measurements == clean.num_measurements
    # The inserted noise actually produces error mechanisms
    assert noisy.detector_error_model(decompose_errors=False).num_errors > 0


def test_zero_rate_sources_insert_nothing():
    text, inserted = apply_noise_sources(CLEAN_REP_CODE, [{"type": "gate2_depolarizing", "p": 0}])
    assert stim.Circuit(text) == stim.Circuit(CLEAN_REP_CODE)
    assert inserted == {}


def test_validate_sources_rejects_bad_input():
    with pytest.raises(ValueError):
        validate_sources([{"type": "nonsense", "p": 0.1}])
    with pytest.raises(ValueError):
        validate_sources([{"type": "gate2_depolarizing", "p": 1.5}])
    with pytest.raises(ValueError):
        validate_sources([{"type": "idle_depolarizing", "p": 0.1, "during": "sometimes"}])
    with pytest.raises(ValueError):
        validate_sources({"type": "gate2_depolarizing", "p": 0.1})
