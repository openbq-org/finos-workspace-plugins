import json
from pathlib import Path

DATA = json.loads((Path(__file__).parent / "flows.json").read_text())
WIDGETS = DATA["widgets"]
FLOWS = DATA["flows"]
