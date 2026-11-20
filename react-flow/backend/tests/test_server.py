import json
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from starlette.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import flows  # noqa: E402
import server  # noqa: E402

MANIFEST = json.loads((BACKEND.parent / "src" / "plugin.json").read_text())
SCHEMA = json.loads((BACKEND.parent / "src" / "graph.schema.json").read_text())
VALIDATOR = Draft202012Validator(SCHEMA)


@pytest.fixture
def client():
    return TestClient(server.app)


def test_every_widget_is_of_the_type_the_plugin_handles(client):
    handled = {h["type"] for w in MANIFEST["contributes"]["widgets"] for h in w["handles"]}
    catalog = client.get("/widgets.json").json()
    assert catalog
    for name, entry in catalog.items():
        assert entry["type"] in handled, name
        assert entry["endpoint"] in flows.FLOWS, name
        assert entry["name"] and entry["description"]


def test_every_endpoint_answers_a_diagram_the_plugin_accepts(client):
    for name, entry in client.get("/widgets.json").json().items():
        answer = client.get(f"/{entry['endpoint']}")
        assert answer.status_code == 200, name
        graph = answer.json()
        VALIDATOR.validate(graph)
        ids = {node["id"] for node in graph["nodes"]}
        assert len(ids) == len(graph["nodes"]), name
        for edge in graph.get("edges", []):
            assert edge["source"] in ids and edge["target"] in ids, name


def test_a_diagram_gives_its_nodes_every_position_or_none(client):
    for entry in client.get("/widgets.json").json().values():
        nodes = client.get(f"/{entry['endpoint']}").json()["nodes"]
        placed = [("x" in node and "y" in node) for node in nodes]
        assert all(placed) or not any(placed)


def test_an_unknown_route_is_not_found(client):
    assert client.get("/no-such-diagram").status_code == 404
