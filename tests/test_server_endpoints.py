"""Tests for the Flask API endpoints added for CLI loading and noise presets."""

import socket

import pytest

from circuitscope.server import app, load_initial_payload, resolve_port


CLEAN_CIRCUIT = "R 0 1\nTICK\nCX 0 1\nTICK\nM 0 1\nDETECTOR(0, 0) rec[-1]"


@pytest.fixture
def client():
    app.config["TESTING"] = True
    app.config["INITIAL_PAYLOAD"] = None
    with app.test_client() as client:
        yield client
    app.config["INITIAL_PAYLOAD"] = None


def test_initial_empty_without_cli_circuit(client):
    response = client.get("/api/initial")
    assert response.status_code == 200
    assert response.get_json() == {}


def test_initial_returns_cli_payload(client):
    app.config["INITIAL_PAYLOAD"] = {"circuit_text": CLEAN_CIRCUIT, "measured_text": "D0, 0.01"}
    payload = client.get("/api/initial").get_json()
    assert payload["circuit_text"] == CLEAN_CIRCUIT
    assert payload["measured_text"] == "D0, 0.01"


def test_load_initial_payload_reads_circuit_and_data(tmp_path):
    circuit_file = tmp_path / "circuit.stim"
    circuit_file.write_text(CLEAN_CIRCUIT + "\n")
    data_file = tmp_path / "run.csv"
    data_file.write_text("shots, 1000\nD0, 0.012\n")

    payload = load_initial_payload(str(circuit_file), str(data_file))
    assert payload["circuit_text"] == CLEAN_CIRCUIT
    assert "D0, 0.012" in payload["measured_text"]

    assert load_initial_payload(None, None) is None


def test_load_initial_payload_reads_utf8(tmp_path):
    # Windows defaults open() to the locale codepage; circuit files must
    # always be read as UTF-8 regardless of platform.
    circuit_file = tmp_path / "circuit.stim"
    circuit_file.write_text("# delay 5µs\n" + CLEAN_CIRCUIT, encoding="utf-8")
    payload = load_initial_payload(str(circuit_file), None)
    assert "5µs" in payload["circuit_text"]


def test_resolve_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        port = busy.getsockname()[1]

        # An explicitly requested busy port is a clean error, not a traceback.
        with pytest.raises(ValueError, match="already in use"):
            resolve_port("127.0.0.1", port)

    # A freed port is accepted when requested explicitly.
    assert resolve_port("127.0.0.1", port) == port

    # With no request, scanning finds some free port at or above the default.
    assert resolve_port("127.0.0.1", None) >= 8050


def test_load_initial_payload_errors():
    with pytest.raises(ValueError, match="not found"):
        load_initial_payload("/nonexistent/path.stim", None)
    with pytest.raises(ValueError, match="--data requires"):
        load_initial_payload(None, "run.csv")


def test_load_initial_payload_rejects_invalid_circuit(tmp_path):
    bad = tmp_path / "bad.stim"
    bad.write_text("BOGUS_GATE 0 1\n")
    with pytest.raises(ValueError, match="not a valid Stim circuit"):
        load_initial_payload(str(bad), None)


def test_noise_endpoint_inserts_sources(client):
    response = client.post("/api/noise", json={
        "circuit_text": CLEAN_CIRCUIT,
        "sources": [{"type": "gate2_depolarizing", "p": 0.005}],
    })
    assert response.status_code == 200
    payload = response.get_json()
    assert "DEPOLARIZE2(0.005) 0 1" in payload["circuit_text"]
    assert payload["inserted"] == {"gate2_depolarizing": 1}


def test_noise_endpoint_strip_only(client):
    noisy = CLEAN_CIRCUIT.replace("CX 0 1", "CX 0 1\nDEPOLARIZE2(0.005) 0 1")
    response = client.post("/api/noise", json={
        "circuit_text": noisy,
        "sources": [],
        "strip_existing": True,
    })
    assert response.status_code == 200
    assert "DEPOLARIZE2" not in response.get_json()["circuit_text"]


def test_montecarlo_endpoint_samples_circuit(client):
    noisy = CLEAN_CIRCUIT.replace("CX 0 1", "CX 0 1\nX_ERROR(0.1) 1")
    response = client.post("/api/montecarlo", json={
        "circuit_text": noisy,
        "shots": 20_000,
        "seed": 5,
    })
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["shots"] == 20_000
    assert len(payload["fractions"]) == 1
    assert payload["fractions"][0] == pytest.approx(0.1, abs=0.01)
    assert payload["counts"][0] == round(payload["fractions"][0] * 20_000)


def test_montecarlo_endpoint_defaults_and_rejects_bad_requests(client):
    # Default shot count applies when none is given
    payload = client.post("/api/montecarlo", json={"circuit_text": CLEAN_CIRCUIT}).get_json()
    assert payload["shots"] == 1_000_000
    assert payload["fractions"] == [0.0]

    assert client.post("/api/montecarlo", json={
        "circuit_text": CLEAN_CIRCUIT, "shots": 0,
    }).status_code == 400
    assert client.post("/api/montecarlo", json={
        "circuit_text": CLEAN_CIRCUIT, "shots": 10**12,
    }).status_code == 400
    assert client.post("/api/montecarlo", json={
        "circuit_text": "BOGUS_GATE 0", "shots": 100,
    }).status_code == 400


def test_noise_endpoint_rejects_bad_requests(client):
    assert client.post("/api/noise", json={"circuit_text": CLEAN_CIRCUIT, "sources": []}).status_code == 400
    assert client.post("/api/noise", json={
        "circuit_text": CLEAN_CIRCUIT,
        "sources": [{"type": "nonsense", "p": 0.1}],
    }).status_code == 400
