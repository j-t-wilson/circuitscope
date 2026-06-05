#!/usr/bin/env python3
"""
CircuitScope Server
===================
A simple Flask server that serves the CircuitScope frontend and provides
an API endpoint for analyzing Stim circuits.

Usage:
    circuitscope  # After pip install, opens browser automatically
"""

import sys
import time
import webbrowser
import threading
from pathlib import Path

from flask import Flask, send_from_directory, request, jsonify

from .analyzer import analyze_circuit_text, create_sample_circuit, CircuitScopeAnalyzer
from .formula_generator import generate_detector_formula, generate_average_formula
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


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Analyze a Stim circuit and return JSON data for visualization.

    Expects JSON body: { "circuit_text": "..." }
    Returns: Circuit analysis JSON
    """
    try:
        data = request.get_json()
        if not data or "circuit_text" not in data:
            return jsonify({"error": "Missing 'circuit_text' in request body"}), 400

        circuit_text = data["circuit_text"].strip()
        if not circuit_text:
            return jsonify({"error": "Circuit text is empty"}), 400

        result = analyze_circuit_text(circuit_text)
        return jsonify(result)

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
        analyzer = CircuitScopeAnalyzer(circuit)
        result = analyzer.export_json()
        return jsonify(result)

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
        if not data or "circuit_text" not in data:
            return jsonify({"error": "Missing 'circuit_text' in request body"}), 400
        if "detector_id" not in data:
            return jsonify({"error": "Missing 'detector_id' in request body"}), 400

        circuit_text = data["circuit_text"].strip()
        if not circuit_text:
            return jsonify({"error": "Circuit text is empty"}), 400

        detector_id = int(data["detector_id"])

        circuit = stim.Circuit(circuit_text)

        if detector_id == -1:
            # Generate average formula
            result = generate_average_formula(circuit)
        else:
            result = generate_detector_formula(circuit, detector_id)

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 400


def open_browser(port: int):
    """Open the browser after a short delay to let the server start."""
    time.sleep(0.5)
    webbrowser.open(f"http://localhost:{port}")


def main():
    """Entry point for the circuitscope command."""
    import argparse

    parser = argparse.ArgumentParser(
        description="CircuitScope - Quantum error correction circuit visualization"
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=8050,
        help="Port to run the server on (default: 8050)"
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

    # Check if static files exist
    if not STATIC_DIR.exists() or not (STATIC_DIR / "index.html").exists():
        print("Error: Static files not found.", file=sys.stderr)
        print(f"Expected at: {STATIC_DIR}", file=sys.stderr)
        print("\nIf you're developing, run 'npm run build' first.", file=sys.stderr)
        sys.exit(1)

    print(f"Starting CircuitScope server at http://{args.host}:{args.port}")

    # Open browser in a separate thread (unless disabled)
    if not args.no_browser:
        threading.Thread(target=open_browser, args=(args.port,), daemon=True).start()

    # Run the Flask server
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
