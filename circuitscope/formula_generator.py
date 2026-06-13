"""
Formula Generator for Detector Event Fractions
===============================================
Generates Python functions expressing detector event fractions as analytical
formulas of the input error parameters.

The core formula is:
    P(D) = 0.5 × (1 - Π(1 - 2×p_effective_i))

where p_effective depends on the error type:
- X_ERROR(p), Y_ERROR(p), Z_ERROR(p): p_effective = p directly
- DEPOLARIZE1(d): p_effective = 0.5 - 0.5×√(1 - 4d/3)
- DEPOLARIZE2(d): p_effective = 0.5 - 0.5×(1 - 16d/15)^(1/8)
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import stim

from .event_fraction_utils import (
    detector_probability_from_independent_toggles,
    _decorrelated_depolarize1_independent_pauli_p,
    _decorrelated_depolarize2_independent_pauli_p,
)

NOISE_PARAMETER_GATES = frozenset({
    "X_ERROR",
    "Y_ERROR",
    "Z_ERROR",
    "CORRELATED_ERROR",
    "DEPOLARIZE1",
    "DEPOLARIZE2",
})

# Template strings for depolarization helper functions (embedded in generated code)
_DEPOL1_HELPER = """    def _depol1_effective(d):
        \"\"\"Convert DEPOLARIZE1 probability to effective toggle probability.\"\"\"
        x = max(0.0, 1.0 - (4.0 / 3.0) * min(d, 0.75))
        return 0.5 - 0.5 * math.sqrt(x)
"""

_DEPOL2_HELPER = """    def _depol2_effective(d):
        \"\"\"Convert DEPOLARIZE2 probability to effective toggle probability.\"\"\"
        x = max(0.0, 1.0 - (16.0 / 15.0) * min(d, 15.0 / 16.0))
        return 0.5 - 0.5 * (x ** (1.0 / 8.0))
"""


@dataclass
class ParameterInfo:
    """Information about a single error parameter in the formula."""
    name: str
    gate_type: str
    original_value: float
    count: int


def _format_value_for_name(value: float) -> str:
    """Convert a float value to a valid Python identifier suffix.

    Examples:
        0.001 -> "0_001"
        0.1 -> "0_1"
        1e-4 -> "1e_4" or "0_0001"
    """
    # Format to avoid scientific notation for small values
    if value < 1e-6:
        formatted = f"{value:.10f}".rstrip('0').rstrip('.')
    elif value < 0.001:
        formatted = f"{value:.6f}".rstrip('0').rstrip('.')
    else:
        formatted = f"{value:.4f}".rstrip('0').rstrip('.')

    # Replace dots and minus signs with underscores
    return formatted.replace('.', '_').replace('-', 'neg')


def _make_param_name(gate_type: str, value: float) -> str:
    """Generate a parameter name from gate type and value.

    Examples:
        DEPOLARIZE1, 0.001 -> "p_depolarize1_0_001"
        X_ERROR, 0.002 -> "p_x_error_0_002"
    """
    gate_lower = gate_type.lower()
    value_str = _format_value_for_name(value)
    return f"p_{gate_lower}_{value_str}"


def _effective_probability(gate_type: str, value: float) -> float:
    """Convert a user-facing gate probability into an independent toggle probability."""
    if gate_type == "DEPOLARIZE1":
        return _decorrelated_depolarize1_independent_pauli_p(value)
    if gate_type == "DEPOLARIZE2":
        return _decorrelated_depolarize2_independent_pauli_p(value)
    return value


def _parameter_from_location(loc: stim.CircuitErrorLocation) -> Optional[Tuple[str, float]]:
    """Return the formula parameter represented by a circuit error location."""
    gate = loc.instruction_targets.gate
    args = list(loc.instruction_targets.args)
    if not args:
        return None

    gate_upper = gate.upper() if gate else ""
    if gate_upper in NOISE_PARAMETER_GATES:
        return gate_upper, float(args[0])

    if loc.flipped_measurement is not None:
        return "M_FLIP", float(args[0])

    return None


def _location_identity(loc: stim.CircuitErrorLocation, gate_type: str, value: float) -> Tuple:
    """Identity for counting unique gate instances in the UI."""
    targets = tuple(t.gate_target.value for t in loc.instruction_targets.targets_in_range)
    return gate_type, value, loc.tick_offset, targets


def _extract_errors_for_detector(
    circuit: stim.Circuit,
    detector_id: int,
) -> Tuple[List[Tuple[str, float]], Dict[Tuple[str, float], int]]:
    """
    Extract all (gate_type, original_probability) pairs that affect a detector.

    Returns:
        errors: List of tuples, one per sub-error location affecting the detector.
            The same (gate_type, value) may appear multiple times if multiple circuit
            locations with that error affect the detector.
        gate_counts: Dict mapping (gate_type, value) to unique gate instance count.
            For DEPOLARIZE errors, this counts unique circuit locations rather than
            sub-errors, providing a more intuitive count for display purposes.
    """
    dem = circuit.detector_error_model(flatten_loops=True)
    explained = circuit.explain_detector_error_model_errors(dem_filter=dem)

    errors: List[Tuple[str, float]] = []
    # Track unique gate locations for DEPOLARIZE errors (for display count)
    seen_gate_locations = set()

    for ee in explained:
        affects_detector = any(
            term.dem_target.is_relative_detector_id() and int(term.dem_target.val) == detector_id
            for term in ee.dem_error_terms
        )
        if not affects_detector:
            continue

        for loc in ee.circuit_error_locations:
            parameter = _parameter_from_location(loc)
            if parameter is None:
                continue

            gate_type, original_prob = parameter
            errors.append(parameter)
            seen_gate_locations.add(_location_identity(loc, gate_type, original_prob))

    # Count unique gate instances per (gate_type, value)
    gate_counts = Counter((gate_type, value) for gate_type, value, _, _ in seen_gate_locations)

    return errors, dict(gate_counts)


def _group_errors(
    errors: List[Tuple[str, float]]
) -> Dict[Tuple[str, float], int]:
    """Group errors by (gate_type, original_value), mapping each to its count."""
    return dict(Counter(errors))


def _compute_event_fraction(
    grouped_errors: Dict[Tuple[str, float], int]
) -> float:
    """
    Compute the detector event fraction from grouped errors.

    Uses the decorrelated formulas for depolarizing channels.
    """
    ps: List[float] = []

    for (gate_type, orig_value), count in grouped_errors.items():
        ps.extend([_effective_probability(gate_type, orig_value)] * count)

    return detector_probability_from_independent_toggles(ps)


def _param_signature(parameters: List[ParameterInfo]) -> str:
    """Render the generated function's parameter list with default values."""
    return ", ".join(f"{p.name}={p.original_value}" for p in parameters)


def _helpers_str(parameters: List[ParameterInfo]) -> str:
    """Return the depolarization helper definitions the parameters require."""
    helpers = []
    if any(p.gate_type == "DEPOLARIZE1" for p in parameters):
        helpers.append(_DEPOL1_HELPER)
    if any(p.gate_type == "DEPOLARIZE2" for p in parameters):
        helpers.append(_DEPOL2_HELPER)
    return "\n".join(helpers)


def _p_eff_expr(p: ParameterInfo) -> str:
    """Expression for a parameter's effective toggle probability in generated code."""
    if p.gate_type == "DEPOLARIZE1":
        return f"_depol1_effective({p.name})"
    if p.gate_type == "DEPOLARIZE2":
        return f"_depol2_effective({p.name})"
    return p.name


def _p_eff_derivative(gate_type: str, value: float) -> float:
    """Compute ∂p_eff/∂p for a given gate type and value.

    For X/Y/Z_ERROR: p_eff = p, so derivative is 1
    For DEPOLARIZE1: p_eff = 0.5 - 0.5*sqrt(1 - 4d/3), derivative is 1/(3*sqrt(1-4d/3))
    For DEPOLARIZE2: p_eff = 0.5 - 0.5*(1-16d/15)^(1/8), derivative is (1/15)*(1-16d/15)^(-7/8)
    """
    if gate_type == "DEPOLARIZE1":
        x = max(1e-10, 1.0 - (4.0 / 3.0) * min(value, 0.75))
        return 1.0 / (3.0 * math.sqrt(x))
    elif gate_type == "DEPOLARIZE2":
        x = max(1e-10, 1.0 - (16.0 / 15.0) * min(value, 15.0 / 16.0))
        return (1.0 / 15.0) * (x ** (-7.0 / 8.0))
    else:
        # X_ERROR, Y_ERROR, Z_ERROR, M_FLIP, etc.
        return 1.0


def _compute_sensitivities(
    grouped_errors: Dict[Tuple[str, float], int]
) -> Dict[Tuple[str, float], float]:
    """Compute ∂P(D)/∂p for each (gate_type, value) pair.

    The sensitivity tells us how much the detector event fraction changes
    per unit change in each error parameter.

    Formula: sensitivity_j = count_j × (∂p_eff_j/∂p_j) × prod / (1 - 2×p_eff_j)
    where prod = Π_i (1 - 2×p_eff_i)^count_i
    """
    if not grouped_errors:
        return {}

    # 1. Compute p_eff for each error type
    p_effs: Dict[Tuple[str, float], float] = {}
    for gate_type, value in grouped_errors:
        p_effs[(gate_type, value)] = _effective_probability(gate_type, value)

    # 2. Compute prod = Π(1 - 2×p_eff)^count
    prod = 1.0
    for (gate_type, value), count in grouped_errors.items():
        p_eff = p_effs[(gate_type, value)]
        prod *= (1.0 - 2.0 * p_eff) ** count

    # 3. Compute sensitivity for each parameter
    sensitivities: Dict[Tuple[str, float], float] = {}
    for (gate_type, value), count in grouped_errors.items():
        p_eff = p_effs[(gate_type, value)]
        dp_eff_dp = _p_eff_derivative(gate_type, value)
        denom = 1.0 - 2.0 * p_eff
        if abs(denom) < 1e-10:
            sensitivity = float('inf')
        else:
            sensitivity = count * dp_eff_dp * prod / denom
        sensitivities[(gate_type, value)] = sensitivity

    return sensitivities


def generate_detector_formula(
    circuit: stim.Circuit,
    detector_id: int,
) -> Dict:
    """
    Generate a Python function expressing the detector event fraction.

    Parameters:
        circuit: The stim circuit
        detector_id: Which detector to generate the formula for

    Returns:
        {
            "python_code": str,        # Complete Python function
            "parameters": [            # List of params with metadata
                {"name": "p_depolarize1_0_001", "gate_type": "DEPOLARIZE1",
                 "original_value": 0.001, "count": 5}
            ],
            "original_event_fraction": float
        }
    """
    # Extract all errors affecting this detector
    errors, gate_counts = _extract_errors_for_detector(circuit, detector_id)

    if not errors:
        # No errors affect this detector
        return {
            "python_code": f"""def detector_D{detector_id}_event_fraction():
    \"\"\"
    Analytical event fraction for detector D{detector_id}.

    This detector is not affected by any error mechanisms.

    Original event fraction: 0.0
    \"\"\"
    return 0.0
""",
            "parameters": [],
            "original_event_fraction": 0.0,
        }

    # Group by (gate_type, value)
    grouped = _group_errors(errors)

    # Compute original event fraction
    original_ef = _compute_event_fraction(grouped)

    # Compute sensitivities
    sensitivities = _compute_sensitivities(grouped)

    # Build parameter list
    parameters: List[ParameterInfo] = []
    param_gate_counts: Dict[str, int] = {}  # Map param name to gate count for display
    for (gate_type, value), count in sorted(grouped.items()):
        name = _make_param_name(gate_type, value)
        parameters.append(ParameterInfo(
            name=name,
            gate_type=gate_type,
            original_value=value,
            count=count,
        ))
        # Store gate count for display (unique gate instances, not sub-errors)
        param_gate_counts[name] = gate_counts.get((gate_type, value), count)

    # Build the docstring
    param_docs = "\n    ".join(
        f"{p.name}: {p.gate_type} probability (appears {p.count}x in circuit)"
        for p in parameters
    )

    contributions_str = "\n".join(
        f"    prod *= (1.0 - 2.0 * {_p_eff_expr(p)}) ** {p.count}"
        for p in parameters
    )

    helpers_str = _helpers_str(parameters)

    # Build the complete function
    code = f"""def detector_D{detector_id}_event_fraction({_param_signature(parameters)}):
    \"\"\"
    Analytical event fraction for detector D{detector_id}.

    Parameters:
    {param_docs}

    Original event fraction: {original_ef:.10g}

    Formula: P(D) = 0.5 * (1 - prod((1 - 2*p_eff)^count))
    where p_eff accounts for depolarizing decorrelation.
    \"\"\"
    import math

{helpers_str}    # Combine independent toggle probabilities
    prod = 1.0
{contributions_str}

    return 0.5 * (1.0 - prod)
"""

    return {
        "python_code": code,
        "parameters": [
            {
                "name": p.name,
                "gate_type": p.gate_type,
                "original_value": p.original_value,
                "count": p.count,
                "gate_count": param_gate_counts.get(p.name, p.count),
                "sensitivity": sensitivities.get((p.gate_type, p.original_value), 0.0),
            }
            for p in parameters
        ],
        "original_event_fraction": original_ef,
    }


def generate_average_formula(circuit: stim.Circuit) -> Dict:
    """
    Generate a Python function for the average detector event fraction.

    This computes the mean event fraction across all detectors, which
    provides a single number characterizing the circuit's overall noise.

    Returns:
        {
            "python_code": str,
            "parameters": [...],
            "original_event_fraction": float,  # The actual average
        }
    """
    dem = circuit.detector_error_model(flatten_loops=True)
    num_detectors = dem.num_detectors

    if num_detectors == 0:
        return {
            "python_code": """def average_detector_event_fraction():
    \"\"\"
    Average detector event fraction.

    This circuit has no detectors.

    Original average event fraction: 0.0
    \"\"\"
    return 0.0
""",
            "parameters": [],
            "original_event_fraction": 0.0,
        }

    # Extract errors once per detector, then use for all computations
    # Store: list of (grouped_errors, event_fraction) per detector
    detector_extractions: List[Tuple[Dict[Tuple[str, float], int], float]] = []
    all_params: Dict[Tuple[str, float], Dict[int, int]] = {}
    all_gate_counts: Counter = Counter()  # Unique gate counts aggregated across detectors
    total_ef = 0.0

    for det_id in range(num_detectors):
        errors, det_gate_counts = _extract_errors_for_detector(circuit, det_id)
        grouped = _group_errors(errors)
        ef = _compute_event_fraction(grouped)
        detector_extractions.append((grouped, ef))
        total_ef += ef

        for key, count in grouped.items():
            all_params.setdefault(key, {})[det_id] = count
        all_gate_counts.update(det_gate_counts)

    original_avg_ef = total_ef / num_detectors

    # Compute average sensitivity per parameter (sum across all detectors, then divide by N)
    # Since avg_ef = (1/N) × Σ P(Di), we have ∂avg_ef/∂p = (1/N) × Σ ∂P(Di)/∂p
    total_sensitivities: Dict[Tuple[str, float], float] = {}
    for grouped, _ in detector_extractions:
        sens = _compute_sensitivities(grouped)
        for key, val in sens.items():
            total_sensitivities[key] = total_sensitivities.get(key, 0.0) + val
    # Divide by num_detectors to get the sensitivity of the average
    for key in total_sensitivities:
        total_sensitivities[key] /= num_detectors

    # Build parameter list (sorted for consistency)
    param_keys = sorted(all_params.keys())
    parameters: List[ParameterInfo] = []

    for gate_type, value in param_keys:
        name = _make_param_name(gate_type, value)
        total_count = sum(all_params[(gate_type, value)].values())
        parameters.append(ParameterInfo(
            name=name,
            gate_type=gate_type,
            original_value=value,
            count=total_count,  # Total across all detectors
        ))

    # Build the docstring
    param_docs = "\n    ".join(
        f"{p.name}: {p.gate_type} probability (total {p.count}x across all detectors)"
        for p in parameters
    )

    helpers_str = _helpers_str(parameters)

    # Per-detector (param_name, gate_type, count) lists, embedded in the
    # generated code as a Python literal
    detector_data = [
        [
            (_make_param_name(gate_type, value), gate_type, count)
            for (gate_type, value), count in sorted(grouped.items())
        ]
        for grouped, _ in detector_extractions
    ]
    detector_data_repr = repr(detector_data)

    # Build the p_eff dispatch for whichever depolarizing types appear
    depol_helpers = (("DEPOLARIZE1", "_depol1_effective"), ("DEPOLARIZE2", "_depol2_effective"))
    branches = [
        (gate, helper)
        for gate, helper in depol_helpers
        if any(p.gate_type == gate for p in parameters)
    ]
    if branches:
        lines = []
        for i, (gate, helper) in enumerate(branches):
            lines.append(f'            {"if" if i == 0 else "elif"} gate_type == "{gate}":')
            lines.append(f"                p_eff = {helper}(p)")
        lines += ["            else:", "                p_eff = p"]
        p_eff_code = "\n".join(lines)
    else:
        p_eff_code = "            p_eff = p"

    # Build the complete function with a loop
    code = f"""def average_detector_event_fraction({_param_signature(parameters)}):
    \"\"\"
    Average detector event fraction across all {num_detectors} detectors.

    Parameters:
    {param_docs}

    Original average event fraction: {original_avg_ef:.10g}

    This provides a single number characterizing the circuit's overall noise level.
    \"\"\"
    import math

{helpers_str}    # Per-detector contributions: list of (param_name, gate_type, count)
    detector_contributions = {detector_data_repr}

    # Map parameter names to values
    params = {{{', '.join(f'"{p.name}": {p.name}' for p in parameters)}}}

    total = 0.0
    for contributions in detector_contributions:
        prod = 1.0
        for param_name, gate_type, count in contributions:
            p = params[param_name]
{p_eff_code}
            prod *= (1.0 - 2.0 * p_eff) ** count
        total += 0.5 * (1.0 - prod)

    return total / {num_detectors}
"""

    # Build per-detector counts for client-side recomputation
    # detector_counts[param_name] = [count_for_d0, count_for_d1, ...]
    detector_counts = {}
    for p in parameters:
        key = (p.gate_type, p.original_value)
        detector_counts[p.name] = [
            all_params[key].get(det_id, 0) for det_id in range(num_detectors)
        ]

    return {
        "python_code": code,
        "parameters": [
            {
                "name": p.name,
                "gate_type": p.gate_type,
                "original_value": p.original_value,
                "count": p.count,
                "gate_count": all_gate_counts.get((p.gate_type, p.original_value), p.count),
                "sensitivity": total_sensitivities.get((p.gate_type, p.original_value), 0.0),
            }
            for p in parameters
        ],
        "original_event_fraction": original_avg_ef,
        "num_detectors": num_detectors,
        "detector_counts": detector_counts,
    }
