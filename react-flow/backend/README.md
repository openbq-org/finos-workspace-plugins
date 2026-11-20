# React Flow data backend

The data backend of the `react-flow` plugin: an example of each kind of diagram the widget draws.
It is a Starlette app that a Workspace admin or user adds under **Connections**. It is not a plugin
backend (a package's `backend/` that Workspace runs through `WIDGET_PLUGIN_BACKENDS`): the plugin
package is built from `../src/` only, and Workspace's API calls this backend for the browser, as it
calls any connection.

## The widgets

All four are of type `reactflow`, in the category *React Flow examples*.

| Widget | Route | Shows |
|---|---|---|
| Order handling | `GET /order-flow` | A process laid out left to right: a pill start, two diamond decisions, a circle end, and the `positive`, `warning` and `negative` accents on the outcomes |
| Release pipeline | `GET /release-pipeline` | A branch and a join laid out top to bottom, with a decision that splits into a released and a blocked path |
| Trade capture services | `GET /service-map` | A map of services, each with a `note` under its name, and a node whose `url` opens a link after the user confirms |
| Incident escalation | `GET /escalation` | A diagram whose nodes carry their own `x` and `y`, so the backend places them and the plugin lays out nothing |

The diagrams and the catalog are data, in [`flows.json`](flows.json), which the server and the
plugin's screenshot suite both read. `GET /widgets.json` answers the catalog. Every answer is the graph that
[`../src/graph.schema.json`](../src/graph.schema.json) describes, and the tests check each one
against that schema.

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --host 127.0.0.1 --port 7810
```

Then add `http://localhost:7810` under **Connections** in FINOS Workspace, and the four widgets
appear in **Add widget** under *React Flow examples* once the plugin is approved, enabled and
granted to your role. The app and the API call this backend from the browser and the server, so
the allowed origins are `http://localhost:3000` and `http://localhost:1420`.

## Test

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

The tests check that every widget in the catalog is of the type the plugin's manifest handles, that
each route answers a diagram that satisfies the plugin's graph schema with no dangling edge, and
that a diagram gives positions to every node or to none.
