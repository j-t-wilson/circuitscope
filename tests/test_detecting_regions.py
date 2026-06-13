"""Tests for detecting-region segments exported by the analyzer.

The analyzer exports, per detector, segments {qubit, pauli, start, end} where
start/end are {tick, order} timeline positions: the segment begins at the
instruction that created the sensitivity and ends at the instruction that
changed or consumed it. These tests pin down that geometry on a small circuit
and cross-validate every example circuit against stim's own per-TICK
detecting_regions() on the unaugmented circuit.
"""

import stim

from circuitscope.analyzer import CircuitScopeAnalyzer


def _position_scalar(pos, num_orders=1_000_000):
    """Map a {tick, order} position to a comparable scalar timeline coordinate.

    Tick boundaries sit exactly at integer ticks; the instruction at order o
    sits strictly inside its tick period.
    """
    if pos is None:
        return float('inf')
    if pos['order'] is None:
        return float(pos['tick'])
    return pos['tick'] + (pos['order'] + 1) / num_orders


def _active_at_boundary(segments, tick_boundary):
    """The {qubit: pauli} sensitivities covered by segments at a tick boundary."""
    active = {}
    for seg in segments:
        start = _position_scalar(seg['start'])
        end = _position_scalar(seg['end'])
        if start <= tick_boundary < end:
            active[seg['qubit']] = seg['pauli']
    return active


def test_hadamard_sandwich_segments():
    """Segments start/end exactly at the gates that create/transform them."""
    circuit = stim.Circuit("""
        R 0
        TICK
        H 0
        TICK
        H 0
        TICK
        M 0
        DETECTOR rec[-1]
    """)
    regions = CircuitScopeAnalyzer(circuit).detecting_regions
    assert regions['D0'] == [
        {'qubit': 0, 'pauli': 'Z', 'start': {'tick': 0, 'order': 0}, 'end': {'tick': 1, 'order': 0}},
        {'qubit': 0, 'pauli': 'X', 'start': {'tick': 1, 'order': 0}, 'end': {'tick': 2, 'order': 0}},
        {'qubit': 0, 'pauli': 'Z', 'start': {'tick': 2, 'order': 0}, 'end': {'tick': 3, 'order': 0}},
    ]


def test_y_sensitivity_is_reported():
    """S gates rotate the sensitivity through Y; Y segments must not be dropped."""
    circuit = stim.Circuit("""
        R 0
        TICK
        H 0
        TICK
        S 0
        TICK
        S 0
        TICK
        H 0
        TICK
        M 0
        DETECTOR rec[-1]
    """)
    regions = CircuitScopeAnalyzer(circuit).detecting_regions
    paulis = {seg['pauli'] for seg in regions['D0']}
    assert 'Y' in paulis


def test_boundary_start_when_circuit_opens_with_tick():
    """A sensitivity already present at an opening TICK starts at the boundary."""
    circuit = stim.Circuit("""
        TICK
        M 0
        DETECTOR rec[-1]
    """)
    regions = CircuitScopeAnalyzer(circuit).detecting_regions
    assert regions['D0'] == [
        {'qubit': 0, 'pauli': 'Z', 'start': {'tick': 1, 'order': None}, 'end': {'tick': 1, 'order': 0}},
    ]


def test_segments_match_stim_tick_regions(example_circuit):
    """At every TICK boundary the active segments must reproduce stim's regions.

    stim reports the sensitivity Pauli at the moment of TICK k, which is the
    boundary between tick periods k and k+1 (scalar coordinate k+1).
    """
    circuit = example_circuit.flattened()
    regions = CircuitScopeAnalyzer(circuit).detecting_regions
    raw = circuit.detecting_regions(ignore_anticommutation_errors=True)

    checked = 0
    for dem_target, tick_sensitivities in raw.items():
        name = str(dem_target)
        if not name.startswith('D'):
            continue
        segments = regions.get(name, [])
        for tick, pauli_string in tick_sensitivities.items():
            pauli_str = str(pauli_string)
            expected = {
                qubit: pauli_str[qubit + 1]
                for qubit in pauli_string.pauli_indices()
            }
            assert _active_at_boundary(segments, tick + 1.0) == expected, (
                f'{name} mismatch at TICK {tick}'
            )
            checked += 1
    assert checked > 0


def test_segments_per_qubit_do_not_overlap(example_circuit):
    """Each qubit has one well-ordered, non-overlapping chain of segments."""
    circuit = example_circuit.flattened()
    regions = CircuitScopeAnalyzer(circuit).detecting_regions
    assert regions

    for name, segments in regions.items():
        by_qubit = {}
        for seg in segments:
            assert seg['pauli'] in ('X', 'Y', 'Z')
            start = _position_scalar(seg['start'])
            end = _position_scalar(seg['end'])
            assert start < end, f'{name} empty segment on q{seg["qubit"]}'
            by_qubit.setdefault(seg['qubit'], []).append((start, end))
        for qubit, spans in by_qubit.items():
            spans.sort()
            for (_, prev_end), (next_start, _) in zip(spans, spans[1:]):
                assert prev_end <= next_start, (
                    f'{name} overlapping segments on q{qubit}'
                )
