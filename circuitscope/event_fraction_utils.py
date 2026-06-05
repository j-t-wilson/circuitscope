from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Tuple
import math
import re
import stim


def _normalize_dem_kwargs(dem_kwargs: Optional[dict]) -> dict:
    """Normalize DEM kwargs with default flatten_loops=True."""
    result = dict(dem_kwargs or {})
    result.setdefault("flatten_loops", True)
    return result


def detector_probability_from_independent_toggles(ps: Iterable[float]) -> float:
    """If independent Bernoulli events each toggle a detector with prob p, returns P(detector fires)."""
    prod = 1.0
    for p in ps:
        # Clamp just in case of tiny numeric drift.
        p = float(p)
        if p <= 0:
            continue
        if p >= 0.5:
            # If this happens, the "independent toggle" interpretation is usually not what you want.
            # Still return something defined.
            p = min(p, 0.5)
        prod *= (1.0 - 2.0 * p)
    return 0.5 * (1.0 - prod)


def _decorrelated_depolarize1_independent_pauli_p(d: float) -> float:
    """
    Convert a disjoint 1-qubit depolarize probability 'd' into an independent-per-Pauli probability 'p'
    such that applying X(p), Y(p), Z(p) independently matches depolarize(d).  (https://algassert.com/post/2001)
    """
    d = float(d)
    # Valid up to d <= 3/4; clamp to avoid sqrt of negative due to user params.
    x = max(0.0, 1.0 - (4.0 / 3.0) * min(d, 0.75))
    return 0.5 - 0.5 * math.sqrt(x)


def _decorrelated_depolarize2_independent_pauli_p(d: float) -> float:
    """
    Convert a disjoint 2-qubit depolarize probability 'd' into an independent-per-(two-qubit-Pauli) probability 'p'
    such that applying the 15 non-identity 2q Paulis independently with prob p matches depolarize2(d). (https://algassert.com/post/2001)
    """
    d = float(d)
    # Valid up to d <= 15/16; clamp.
    x = max(0.0, 1.0 - (16.0 / 15.0) * min(d, 15.0 / 16.0))
    # sqrt(sqrt(sqrt(x))) = x^(1/8)
    return 0.5 - 0.5 * (x ** (1.0 / 8.0))


def _pauli_product_label(flipped_pauli_product: List[stim.GateTargetWithCoords]) -> str:
    """
    Best-effort human-readable label for the Pauli product (used for grouping).
    Example strings look like 'X0', 'Y3', 'Z5*X2'.
    """
    if not flipped_pauli_product:
        return "NO_PAULI"

    def format_target(t: stim.GateTargetWithCoords) -> str:
        gt = t.gate_target
        qubit = gt.value
        # Determine pauli type from the gate target
        if gt.is_x_target:
            return f"X{qubit}"
        elif gt.is_y_target:
            return f"Y{qubit}"
        elif gt.is_z_target:
            return f"Z{qubit}"
        else:
            # Fallback: try to parse from string representation
            s = str(gt)
            # Format: "stim.target_x(3)" -> "X3"
            m = re.match(r'stim\.target_([xyz])\((\d+)\)', s)
            if m:
                return f"{m.group(1).upper()}{m.group(2)}"
            return s

    return "*".join(format_target(t) for t in flipped_pauli_product)


def _effective_location_probability(loc: stim.CircuitErrorLocation) -> float:
    """
    Extract the probability of this specific explained circuit error location.

    Handles:
      - X_ERROR / Y_ERROR / Z_ERROR / CORRELATED_ERROR (uses the gate arg directly)
      - DEPOLARIZE1 / DEPOLARIZE2 (decorrelates disjoint depolarization into independent terms) (https://algassert.com/post/2001)
      - M(p), MR(p), MX(p), MY(p), MZ(p) etc when used as measurement-flip noise via args.
    """
    gate = loc.instruction_targets.gate
    args = list(loc.instruction_targets.args)

    if gate is None:
        raise ValueError("Encountered CircuitErrorLocation with gate=None.")

    g = gate.upper()

    # Most explicit error instructions carry a single probability parameter.
    if g in {"X_ERROR", "Y_ERROR", "Z_ERROR", "CORRELATED_ERROR"}:
        if not args:
            raise ValueError(f"{gate} had no args; expected one probability.")
        return float(args[0])

    # Depolarizing instructions are disjoint channels; convert to independent-per-Pauli prob p.
    # (This is exactly why your budget needs the conversion.)
    if g == "DEPOLARIZE1":
        if not args:
            raise ValueError("DEPOLARIZE1 had no args; expected one probability.")
        d = float(args[0])
        return _decorrelated_depolarize1_independent_pauli_p(d)

    if g == "DEPOLARIZE2":
        if not args:
            raise ValueError("DEPOLARIZE2 had no args; expected one probability.")
        d = float(args[0])
        return _decorrelated_depolarize2_independent_pauli_p(d)

    # Measurement instructions can carry a flip prob in parentheses in stim circuits.
    # If this location is a flipped_measurement, treat arg[0] as the flip probability.
    if loc.flipped_measurement is not None and args:
        return float(args[0])

    # If you need more gates here (e.g. PAULI_CHANNEL_1/2, E/ERASE, etc.), extend this function.
    raise NotImplementedError(
        f"Don't know how to extract probability for gate '{gate}' with args={args}. "
        f"Extend _effective_location_probability for your noise model."
    )


def detector_event_fractions_from_dem(
    circuit: stim.Circuit,
    *,
    dem_kwargs: Optional[dict] = None,
) -> List[float]:
    """
    Computes detector event fractions from the circuit's detector error model by:
      - collecting all independent error(p) terms that include each detector target
      - combining via 0.5*(1 - Π(1-2p))
    """
    dem = circuit.detector_error_model(**_normalize_dem_kwargs(dem_kwargs))

    num_det = dem.num_detectors
    per_det_ps: List[List[float]] = [[] for _ in range(num_det)]

    def detector_shift_amount(inst: stim.DemInstruction) -> int:
        targets = inst.targets_copy()
        if targets:
            return int(targets[0])
        args = inst.args_copy()
        if args:
            return int(args[0])
        return 0

    def collect_error_probabilities(model: stim.DetectorErrorModel, det_shift: int) -> int:
        for inst in model:
            t = inst.type
            if t == "repeat":
                body = inst.body_copy()
                for _ in range(inst.repeat_count):
                    det_shift = collect_error_probabilities(body, det_shift)
                continue

            if t == "shift_detectors":
                det_shift += detector_shift_amount(inst)
                continue
            if t != "error":
                continue

            p = float(inst.args_copy()[0])
            for target in inst.targets_copy():
                if isinstance(target, stim.DemTarget) and target.is_relative_detector_id():
                    det_id = det_shift + target.val
                    if 0 <= det_id < num_det:
                        per_det_ps[det_id].append(p)

        return det_shift

    collect_error_probabilities(dem, 0)

    return [detector_probability_from_independent_toggles(ps) for ps in per_det_ps]


@dataclass(frozen=True)
class BudgetItem:
    count: int
    sum_p: float
    p_if_only_this_group: float
    log_weight: float
    share_of_log_weight: float
    example_locations: Tuple[str, ...]


@dataclass(frozen=True)
class DetectorBudgetResult:
    # DEM-derived detector event fractions.
    det_p_dem: List[float]
    # Reconstructed from explain (should match dem-derived if your noise gates are all handled).
    det_p_from_explain: List[float]
    # For each detector, a mapping group_key -> BudgetItem.
    budget: List[Dict[str, BudgetItem]]


def detector_error_budgets_from_explain(
    circuit: stim.Circuit,
    *,
    dem_kwargs: Optional[dict] = None,
    group_key_fn: Optional[Callable[[stim.CircuitErrorLocation], str]] = None,
    max_examples_per_group: int = 3,
) -> DetectorBudgetResult:
    """
    Builds per-detector budgets using explain_detector_error_model_errors:
      - Uses dem_filter=<generated dem> so explanations are tied to the same DEM.
      - For each ExplainedError, for each CircuitErrorLocation, computes an effective independent probability.
      - Adds that probability into every detector touched by that dem error term.
      - Groups locations by group_key_fn (default: "<gate>:<pauli_product>").

    Depolarize conversion uses "decorrelated depolarization" formulas. (https://algassert.com/post/2001)
    """
    dem_kwargs = _normalize_dem_kwargs(dem_kwargs)
    dem = circuit.detector_error_model(**dem_kwargs)

    num_det = dem.num_detectors

    if group_key_fn is None:
        def group_key_fn(loc: stim.CircuitErrorLocation) -> str:
            gate = loc.instruction_targets.gate or "UNKNOWN"
            pauli = _pauli_product_label(loc.flipped_pauli_product)
            g = gate.upper() if gate else ""

            # For 2-qubit depolarizing channels, include the qubit pair in the key
            # so that different qubit pairs are treated as different error mechanisms.
            # This matches the treatment of other error types where different qubits
            # result in different budget entries.
            if g == "DEPOLARIZE2":
                targets = loc.instruction_targets.targets_in_range
                # GateTargetWithCoords has gate_target.value for the qubit index
                qubits = sorted([t.gate_target.value for t in targets])
                if len(qubits) >= 2:
                    return f"{gate} q{qubits[0]},q{qubits[1]}:{pauli}"

            return f"{gate}:{pauli}"

    # Collect per-detector per-group probability lists and example strings.
    per_det_group_ps: List[Dict[str, List[float]]] = [dict() for _ in range(num_det)]
    per_det_group_examples: List[Dict[str, List[str]]] = [dict() for _ in range(num_det)]
    per_det_all_ps: List[List[float]] = [[] for _ in range(num_det)]

    explained = circuit.explain_detector_error_model_errors(dem_filter=dem)

    for ee in explained:
        # Which detectors does this DEM error term touch?
        det_ids: List[int] = []
        for term in ee.dem_error_terms:
            dt = term.dem_target
            if dt.is_relative_detector_id():
                det_ids.append(int(dt.val))
        if not det_ids:
            continue

        # Each CircuitErrorLocation is a separate *place* in the circuit that can realize this DEM term.
        # We count them all (as you requested).
        for loc in ee.circuit_error_locations:
            p_loc = _effective_location_probability(loc)
            key = group_key_fn(loc)

            # Store a compact example string.
            ex = f"{loc.instruction_targets.gate}{tuple(loc.instruction_targets.args)} @tick+{loc.tick_offset}"
            # Include a bit of stack info if present.
            if loc.stack_frames:
                sf = loc.stack_frames[-1]
                ex += f" (inst#{sf.instruction_offset}, iter={sf.iteration_index})"

            for d in det_ids:
                if 0 <= d < num_det:
                    per_det_all_ps[d].append(p_loc)

                    per_det_group_ps[d].setdefault(key, []).append(p_loc)
                    if max_examples_per_group > 0:
                        lst = per_det_group_examples[d].setdefault(key, [])
                        if len(lst) < max_examples_per_group:
                            lst.append(ex)

    det_p_dem = detector_event_fractions_from_dem(circuit, dem_kwargs=dem_kwargs)
    det_p_from_explain = [detector_probability_from_independent_toggles(ps) for ps in per_det_all_ps]

    budgets: List[Dict[str, BudgetItem]] = []
    for d in range(num_det):
        items: Dict[str, BudgetItem] = {}
        # Compute total log-weight for shares.
        total_log_w = 0.0
        tmp: Dict[str, Tuple[List[float], float]] = {}
        for k, ps in per_det_group_ps[d].items():
            log_w = 0.0
            for p in ps:
                # log(1-2p) < 0 so -log(...) is a positive "weight"
                log_w += -math.log(max(1e-300, 1.0 - 2.0 * float(p)))
            tmp[k] = (ps, log_w)
            total_log_w += log_w

        for k, (ps, log_w) in tmp.items():
            p_only = detector_probability_from_independent_toggles(ps)
            share = (log_w / total_log_w) if total_log_w > 0 else 0.0
            items[k] = BudgetItem(
                count=len(ps),
                sum_p=float(sum(ps)),
                p_if_only_this_group=float(p_only),
                log_weight=float(log_w),
                share_of_log_weight=float(share),
                example_locations=tuple(per_det_group_examples[d].get(k, [])),
            )
        budgets.append(items)

    return DetectorBudgetResult(
        det_p_dem=det_p_dem,
        det_p_from_explain=det_p_from_explain,
        budget=budgets,
    )
