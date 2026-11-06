# Flow diagrams for Workspace

A Workspace widget plugin that draws the `reactflow` widget type with
[React Flow](https://reactflow.dev/) 12.12. Any backend whose `widgets.json` declares a widget of
type `reactflow`, and whose endpoint returns a graph of nodes and edges, is drawn by this plugin
once a Workspace deployment has approved and enabled it. The plugin has no plugin backend, no proxy
and no secret, and its frame reaches no host.

The diagram is editable. The user moves, connects, renames, adds and deletes boxes on the card, and
the AI agent reads and rewrites the same diagram, because both work on one setting of the widget.

Nothing in the plugin imports Workspace code. It talks to Workspace only through the widget plugin
contract: `plugin.json`, the AFM module in `entry.js`, traits and host commands. The same built
package serves FINOS Workspace and BQ Workspace.

## The contract

The widget's endpoint returns the diagram as JSON. `x` and `y` are optional: a diagram without them
is laid out with [dagre](https://github.com/dagrejs/dagre) in the `direction` the diagram asks for.

```json
{
  "title": "Order handling",
  "direction": "LR",
  "nodes": [
    { "id": "in", "label": "Order received", "kind": "input", "shape": "pill" },
    { "id": "check", "label": "In stock?", "shape": "diamond" },
    { "id": "ship", "label": "Ship", "kind": "output", "accent": "positive" },
    { "id": "back", "label": "Back order", "kind": "output", "accent": "warning" }
  ],
  "edges": [
    { "source": "in", "target": "check" },
    { "source": "check", "target": "ship", "label": "yes" },
    { "source": "check", "target": "back", "label": "no", "dashed": true }
  ]
}
```

`src/graph.schema.json` is the whole contract, and the build puts it into the manifest as the
artifact's data schema. A backend declares the widget with its type and endpoint:

```json
{
  "order-flow": {
    "name": "Order handling",
    "type": "reactflow",
    "endpoint": "/order-flow"
  }
}
```

Workspace adds `theme=dark` or `theme=light` to the endpoint's query, the site's mode, and asks
again when the user switches it. The plugin draws the boxes and arrows in the site's own colours
and switches with it, so an endpoint can ignore `theme`:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/order-flow")
def order_flow(theme: str = "dark") -> dict:
    return {
        "nodes": [{"id": "in", "label": "Order received"}, {"id": "ship", "label": "Ship"}],
        "edges": [{"source": "in", "target": "ship"}],
    }
```

An answer that holds no `nodes` list shows "This widget did not get a diagram."

### The fields

| Node | What it is |
|---|---|
| `id` | The id the edges refer to. Used once; a repeat is dropped. |
| `label` | The text in the box. Falls back to the id. |
| `note` | A second, smaller line under the label. |
| `kind` | `default` (both ends), `input` (only starts a flow) or `output` (only ends one). |
| `shape` | `rounded` (the default), `rectangle`, `pill`, `diamond` or `circle`. |
| `accent` | `neutral` (the default), `brand`, `positive`, `negative`, `warning` or `info`, taken from the site's theme. |
| `url` | An `https:` or `mailto:` address the box opens, after the user confirms. |
| `x`, `y` | The position. Give them on every node or on none. |
| `width`, `height` | The size of the box, when the shape's own size does not fit. |

| Edge | What it is |
|---|---|
| `source`, `target` | The nodes the arrow joins. An edge that names a node that is not there is dropped. |
| `id` | The id of the edge. One is made when it is left out. |
| `label` | The text on the arrow. |
| `accent` | The colour of the arrow, from the same list as a node's. |
| `dashed`, `animated`, `arrow` | A broken line, moving dashes, and the arrow head, which is on by default. |

A diagram holds at most 300 nodes and 600 edges, and at most 24,000 characters once it is saved.

## What every card has

- **The canvas.** Drag the background to pan and use the mouse wheel or a pinch to zoom. The diagram
  is fitted to the card when it opens, at 80% scale or more, and a diagram larger than the card is
  panned.
- **Editing.** Dragging moves a box, dragging from an edge of a box draws an arrow, a double click
  renames a box, and Delete removes what is selected. Every change is saved to the widget's `graph`
  setting about half a second later. Editing needs the permission `core:config:write`: without it
  the card pans, zooms and selects only.
- **The card's own buttons.** The widget declares two actions, which FINOS Workspace draws itself:
  **Add node** is a button in the card's header and puts a new box at the free spot nearest the
  middle of the view that is fully visible, and **Revert to source** is an item in the card's
  options menu. The module receives the `action` event and does the work.
- **One diagram for the user and the agent.** The `graph` setting is a JSON string that the module
  writes, the AI agent reads with `read_widget` as `ui_args.config.graph` and sets with
  `update_widget`, and an admin can read in the widget's settings. While it is empty the card shows
  what the endpoint returns, and *Revert to source* empties it again.
- **Links.** A node with a `url` has a link button, which opens the address with the host command
  `core:ui:open-link`, for `https:` and `mailto:` only and after the user confirms.
- **Exports.** The card's Export entry offers *Diagram (JSON)*: the diagram as it stands, which is
  what another diagram or an endpoint can be built from.
- **Copilot context.** The AI agent reads the diagram that is showing, including the user's own
  changes, when it is asked about the dashboard.
- **The diagram in the chat.** The widget is also an agent component. The AI agent draws a diagram
  under its answer from nodes and edges it writes, and the user can add the card to a dashboard. A
  card in the chat is read-only. The plugin's
  skill, `skills/flow-diagrams.md`, tells the agent which shapes and colours to use and how to
  change a diagram that is already on a dashboard.

## Model traits

The manifest declares no `model`, so the widget has the host's default traits. The module reads
four and writes one:

| Trait | Purpose |
|---|---|
| `data` | The endpoint's answer, or the data the agent gave the artifact: the diagram. |
| `config` | The widget's settings. `config.graph` is the diagram the user and the agent share, and the module writes it back. |
| `theme` | The site's mode and its colour and font tokens, which the card's own colours follow. |
| `capabilities` | The widget's effective permissions. The card is read-only when `core:config:write` is not among them. |

## Permissions

| Permission | Used for |
|---|---|
| `core:data:read` | Reading the endpoint's answer. |
| `core:config:write` | Saving the user's changes to the `graph` setting. |
| `core:export:provide` | The Export entry. |
| `core:copilot:context` | The diagram that is showing, for the AI agent. |
| `core:ui:open-link` | Opening a node's link after the user confirms. |
| `core:ui:notify` | Saying that a diagram grew too large to save. |
| `core:ui:button` | The **Add node** button in the card's header. |
| `core:ui:menu` | The **Revert to source** item in the card's options menu. |

The manifest adds nothing to the frame's CSP. React, React Flow and dagre run without `eval`, and
the build fails when `entry.js` contains `eval(` or `new Function(`, when it imports a remote
module, or when `entry.css` loads a remote file.

## Build

```bash
npm ci          # exact versions from package-lock.json
npm run build   # writes dist/react-flow/<version>/
npm run verify  # checks the package as Workspace's discovery does, prints its digest
```

The build bundles the plugin, React, React Flow and dagre into the one module `entry.js`, because a
plugin frame loads a single module, and it bundles React Flow's stylesheet with the plugin's own
into `entry.css`. It expands `{"$include": "graph.schema.json"}` in the manifest, so the graph
contract is written once, copies the icon and the skill, writes the licence of every bundled
package into `assets/THIRD-PARTY-LICENSES.txt`, computes the checksum, and writes `plugin.json`
with `version` and `checksum`. It stops when a bundled package has a licence that `build.mjs` has
not cleared (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD), or no licence file.

The package Workspace consumes is the folder `dist/react-flow/<version>/`:

```
dist/react-flow/1.1.1/
  plugin.json                      manifest; version, checksum and the graph schema written by the build
  entry.js                         the AFM module (entry.module)
  entry.css                        the styles (entry.styles)
  assets/icon.svg                  the icon
  assets/add-node.svg              the Add node button's icon
  assets/revert.svg                the Revert to source menu item's icon
  assets/THIRD-PARTY-LICENSES.txt  the licence of every bundled package
  skills/flow-diagrams.md          the agent's skill
```

`npm run verify` prints the version digest a deployer pins in `WIDGET_PLUGINS_PINS`. Workspace's own
validator stays the authority, from a Workspace checkout's `backend-api/backend`:

```bash
python -m scripts.plugin_check <path>/dist/react-flow/<version>          # full check
python -m scripts.plugin_check --digest <path>/dist/react-flow/<version> # checksum and digest
```

Every change is a new version: raise `version` in `package.json` and build again. Workspace blocks a
version whose files change after it was discovered, and keeps it blocked.

## Test

```bash
npm test
```

`tsc --noEmit` typechecks the plugin, which is written in TypeScript, and the tests then run in
Node. `graph.test.ts` covers reading a diagram from an answer, from JSON text and from junk, the
bounds of every field, and that `src/graph.schema.json` and the TypeScript types declare the same
fields. `layout.test.ts` covers the sizes, the automatic layout, the diagrams it leaves alone and where a
new node goes, and `manifest.test.ts` the manifest, including the card actions and their icons.
Drawing needs a browser, which the next section uses.

## Screenshots

`e2e/screenshots.spec.mjs` drives a running Workspace with Playwright and writes the images in
`screenshots/` at twice the page's resolution: the two example diagrams on a dashboard, the Add
node button with its tooltip, the result of Add node, the card's options menu with Revert to
source, and the same dashboard in light mode. It needs the plugin approved, enabled and running on
the stack, an administrator, and an empty dashboard of theirs to draw on:

```bash
E2E_USER_EMAIL=<admin email> E2E_USER_PASSWORD=<password> E2E_DASHBOARD_ID=<dashboard uuid> npm run e2e
```

The suite serves `backend/flows.json` itself, registers it under **Connections** as *React Flow
examples* if it is not there yet, grants it to a temporary role that it deletes at the end, and
adds the two widgets to the dashboard if they are not on it. `E2E_BASE_URL` (default
`http://localhost:1420`) and `E2E_API_URL` (default `http://localhost:8000`) name the stack,
`E2E_BACKEND_HOST` (default `host.docker.internal`) how the stack reaches the suite's backend, and
`E2E_CHROMIUM` a Chromium to run instead of Playwright's own.

## Deploy

1. Copy `dist/react-flow/<version>/` into the plugins directory (`WIDGET_PLUGINS_DIR`), as
   `react-flow/<version>/`.
2. Where versions must be pinned, add the digest to `WIDGET_PLUGINS_PINS` as
   `"react-flow@<version>": "<digest>"`.
3. Admin, Widgets, Deployment: Rescan, review, approve, and enable the plugin. Grant it to the roles
   that may use it.
4. Add the data backend under Connections, and put its widgets on a dashboard.

## Try it on a local Workspace

```bash
npm ci && npm run build
WORKSPACE_PLUGINS_DIR=<plugins directory> npm run install:workspace
```

`install:workspace` runs `verify`, then copies `dist/react-flow/<version>/` to
`<plugins directory>/react-flow/<version>/`, next to the versions already there. It does nothing
when that version is already there with the same files, and refuses when its files differ: raise the
version instead. Then rescan and approve in Admin, Widgets, Deployment.
