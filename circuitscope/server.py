#!/usr/bin/env python3
"""
CircuitScope Server
===================
A simple Flask server that serves the CircuitScope frontend and provides
an API endpoint for analyzing Stim circuits.

Usage:
    circuitscope                                  # opens browser automatically
    circuitscope mycircuit.stim                   # open with a circuit pre-analyzed
    cat mycircuit.stim | circuitscope -           # same, from stdin
    circuitscope mycircuit.stim --data run.csv    # also preload measured fractions
"""

import socket
import sys
import time
import webbrowser
import threading
from pathlib import Path

from flask import Flask, send_from_directory, request, jsonify

from .analyzer import analyze_circuit_text, create_sample_circuit, CircuitScopeAnalyzer
from .formula_generator import generate_detector_formula, generate_average_formula
from .noise_presets import apply_noise_sources, strip_noise
from .propagation import propagate_pauli
from .sampling import monte_carlo_payload, DEFAULT_SHOTS
import stim


# Find the static files directory (bundled with the package)
STATIC_DIR = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR))


@app.route("/")
def serve_index():
    """Serve the main index.html."""
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def serve_static(path):
    """Serve static files (JS, CSS, etc.)."""
    return send_from_directory(STATIC_DIR, path)


def _circuit_text_from_request(data) -> str:
    """Extract and validate 'circuit_text' from a JSON request body."""
    if not data or "circuit_text" not in data:
        raise ValueError("Missing 'circuit_text' in request body")
    circuit_text = data["circuit_text"].strip()
    if not circuit_text:
        raise ValueError("Circuit text is empty")
    return circuit_text


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Analyze a Stim circuit and return JSON data for visualization.

    Expects JSON body: { "circuit_text": "..." }
    Returns: Circuit analysis JSON
    """
    try:
        circuit_text = _circuit_text_from_request(request.get_json())
        return jsonify(analyze_circuit_text(circuit_text))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/sample", methods=["GET"])
def sample():
    """
    Return a sample circuit for testing.

    Query params:
    - distance: Code distance (default: 3)
    - rounds: Number of rounds (default: 2)
    """
    try:
        distance = int(request.args.get("distance", 3))
        rounds = int(request.args.get("rounds", 2))

        circuit = create_sample_circuit(distance=distance, rounds=rounds)
        return jsonify(CircuitScopeAnalyzer(circuit).export_json())
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/formula", methods=["POST"])
def formula():
    """
    Generate an analytical formula for a detector's event fraction.

    Expects JSON body: { "circuit_text": "...", "detector_id": 0 }
    Use detector_id = -1 for average across all detectors.
    Returns: { "python_code": str, "parameters": [...], "original_event_fraction": float }
    """
    try:
        data = request.get_json()
        circuit_text = _circuit_text_from_request(data)
        if "detector_id" not in data:
            return jsonify({"error": "Missing 'detector_id' in request body"}), 400

        detector_id = int(data["detector_id"])
        circuit = stim.Circuit(circuit_text)

        if detector_id == -1:
            result = generate_average_formula(circuit)
        else:
            result = generate_detector_formula(circuit, detector_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/montecarlo", methods=["POST"])
def montecarlo():
    """
    Sample the circuit's detectors stochastically so the UI can overlay
    sampled event fractions (± error bars) next to the analytical ones.

    Expects JSON body: { "circuit_text": "...", "shots": 1000000, "seed": 42 }
    (shots defaults to 1_000_000; seed is optional and mainly for tests).
    Returns: { "shots": int, "counts": [int, ...], "fractions": [float, ...] }
    indexed by detector id.
    """
    try:
        data = request.get_json()
        circuit_text = _circuit_text_from_request(data)
        shots = int(data.get("shots", DEFAULT_SHOTS))
        seed = data.get("seed")
        if seed is not None:
            seed = int(seed)
        return jsonify(monte_carlo_payload(circuit_text, shots, seed=seed))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/propagate", methods=["POST"])
def propagate():
    """
    Propagate one Pauli component of an error channel through the circuit,
    returning the tick-by-tick frames for the timeline's propagation overlay.

    Expects JSON body: {
        "circuit_text": "...",
        "tick": 3,                  # timeline tick of the error instruction
        "name": "DEPOLARIZE1",      # error instruction name
        "qubits": [2],              # qubits of the clicked channel instance
        "pauli": "X2"               # flipped Pauli product to inject
    }
    Returns: { "start_tick": int, "frames": {tick: [{qubit, pauli}]},
               "flipped_measurements": [int], "flipped_detectors": [int] }
    """
    try:
        data = request.get_json()
        circuit_text = _circuit_text_from_request(data)
        for field in ("tick", "name", "pauli"):
            if field not in data:
                return jsonify({"error": f"Missing '{field}' in request body"}), 400
        result = propagate_pauli(
            circuit_text,
            int(data["tick"]),
            data["name"],
            [int(q) for q in data.get("qubits", [])],
            data["pauli"],
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/initial", methods=["GET"])
def initial():
    """
    Return the circuit (and optional measured data text) given on the command
    line, so the frontend can open pre-analyzed. Empty object when the server
    was started without a circuit argument.

    Returns: { "circuit_text": str, "measured_text": str|null } or {}
    """
    return jsonify(app.config.get("INITIAL_PAYLOAD") or {})


@app.route("/api/noise", methods=["POST"])
def noise():
    """
    Insert composable noise sources into a circuit (and/or strip existing
    noise), returning the new circuit text.

    Expects JSON body: {
        "circuit_text": "...",
        "sources": [{"type": "gate2_depolarizing", "p": 0.005},
                    {"type": "idle_depolarizing", "p": 0.001, "during": "measure"}, ...],
        "strip_existing": false
    }
    Source types: gate2_depolarizing, gate1_depolarizing, reset_flip,
    measure_flip, idle_depolarizing (with "during": gate2 | measure | all).
    Returns: { "circuit_text": str, "inserted": {type: instruction_count} }
    """
    try:
        data = request.get_json()
        circuit_text = _circuit_text_from_request(data)
        sources = data.get("sources", [])
        strip_existing = bool(data.get("strip_existing", False))

        if not sources and strip_existing:
            return jsonify({"circuit_text": strip_noise(circuit_text), "inserted": {}})
        if not sources:
            return jsonify({"error": "No noise sources given (and strip_existing is false)"}), 400

        new_text, inserted = apply_noise_sources(circuit_text, sources, strip_existing=strip_existing)
        return jsonify({"circuit_text": new_text, "inserted": inserted})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


DEFAULT_PORT = 8050


def _port_available(host: str, port: int) -> bool:
    """Check whether a TCP port can be bound on the given host."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            return False
    return True


def resolve_port(host: str, requested):
    """
    Pick the port to serve on. An explicitly requested port must be free;
    with no request, scan upward from the default so a second instance
    just works instead of dying on a bind error.
    """
    if requested is not None:
        if not _port_available(host, requested):
            raise ValueError(
                f"Port {requested} is already in use "
                f"(omit --port to pick a free one automatically)"
            )
        return requested
    for port in range(DEFAULT_PORT, DEFAULT_PORT + 50):
        if _port_available(host, port):
            return port
    raise ValueError(f"No free port found in {DEFAULT_PORT}-{DEFAULT_PORT + 49}")


def open_browser(port: int):
    """Open the browser after a short delay to let the server start."""
    time.sleep(0.5)
    webbrowser.open(f"http://localhost:{port}")


def load_initial_payload(circuit_arg, data_arg):
    """
    Read the CLI circuit file (or stdin for '-') and optional measured-data
    file into the payload served by /api/initial.

    Raises ValueError with a user-facing message on unreadable files or an
    unparseable circuit. The measured data file is passed through as text and
    parsed client-side (same parser as the Import data modal).
    """
    if data_arg and not circuit_arg:
        raise ValueError("--data requires a circuit file to compare against")
    if not circuit_arg:
        return None

    if circuit_arg == "-":
        circuit_text = sys.stdin.buffer.read().decode("utf-8")
    else:
        circuit_path = Path(circuit_arg)
        if not circuit_path.exists():
            raise ValueError(f"Circuit file not found: {circuit_arg}")
        circuit_text = circuit_path.read_text(encoding="utf-8")
    circuit_text = circuit_text.strip()
    if not circuit_text:
        raise ValueError("Circuit file is empty")
    try:
        stim.Circuit(circuit_text)
    except Exception as e:
        raise ValueError(f"Circuit file is not a valid Stim circuit: {e}")

    measured_text = None
    if data_arg:
        data_path = Path(data_arg)
        if not data_path.exists():
            raise ValueError(f"Data file not found: {data_arg}")
        measured_text = data_path.read_text(encoding="utf-8")

    return {"circuit_text": circuit_text, "measured_text": measured_text}


def main():
    """Entry point for the circuitscope command."""
    import argparse

    parser = argparse.ArgumentParser(
        description="CircuitScope - Quantum error correction circuit visualization"
    )
    parser.add_argument(
        "circuit",
        nargs="?",
        help="Stim circuit file to open pre-analyzed ('-' reads from stdin)"
    )
    parser.add_argument(
        "--data",
        help="Measured detector fractions (CSV or JSON, as accepted by the "
             "Import data modal) to preload alongside the circuit"
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=None,
        help="Port to run the server on (default: 8050, or the next free port)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't automatically open the browser"
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)"
    )

    args = parser.parse_args()

    try:
        app.config["INITIAL_PAYLOAD"] = load_initial_payload(args.circuit, args.data)
        port = resolve_port(args.host, args.port)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # Check if static files exist
    if not STATIC_DIR.exists() or not (STATIC_DIR / "index.html").exists():
        print("Error: Static files not found.", file=sys.stderr)
        print(f"Expected at: {STATIC_DIR}", file=sys.stderr)
        print("\nIf you're developing, run 'npm run build' first.", file=sys.stderr)
        sys.exit(1)

    print(f"Starting CircuitScope server at http://{args.host}:{port}")

    # Open browser in a separate thread (unless disabled)
    if not args.no_browser:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    # Run the Flask server
    app.run(host=args.host, port=port, debug=False)


if __name__ == "__main__":
    main()
