# Mermaid diagrams for Workspace

A Workspace widget plugin that draws the `mermaid` widget type with [Mermaid](https://mermaid.js.org/)
12.3. Any backend whose `widgets.json` declares a widget of type `mermaid`, and whose endpoint
returns Mermaid text, is drawn by this plugin once a Workspace deployment has approved and enabled
it. The plugin has no plugin backend, no proxy and no secret, and its frame reaches no host.

Nothing in the plugin imports Workspace code. It talks to Workspace only through the widget plugin
contract: `plugin.json`, the AFM module in `entry.js`, traits and host commands. The same built
package serves FINOS Workspace and BQ Workspace.

## The contract

The widget's endpoint returns the diagram as a JSON string, or as an object with the key `diagram`:

```json
{ "diagram": "flowchart LR\n  A[Request] --> B{Valid?}\n  B -- yes --> C[Process]\n  B -- no --> D[Reject]" }
```

A code fence around the text (```` ```mermaid ````) is taken off. A backend declares the widget with
its type and endpoint, and there is nothing else to configure:

```json
{
  "orders-flow": {
    "name": "Order flow",
    "type": "mermaid",
    "endpoint": "/orders-flow"
  }
}
```

Workspace adds `theme=dark` or `theme=light` to the endpoint's query, the site's mode, and asks
again when the user switches it. The plugin draws the diagram in that mode's colours, and draws it
again when the mode changes. An endpoint can ignore `theme`:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/orders-flow")
def orders_flow(theme: str = "dark") -> dict:
    return {"diagram": "flowchart LR\n  A[Request] --> B{Valid?}\n  B -- yes --> C[Process]\n  B -- no --> D[Reject]"}
```

An answer that holds no text shows "The endpoint did not return a Mermaid diagram.", and a diagram
that Mermaid refuses shows Mermaid's message on the card, with the line of the error.

## What it draws

Every diagram type of Mermaid 12.3, as the text declares it: flowchart, sequence, class, state,
entity-relationship, Gantt, pie, mindmap, timeline, git graph, user journey, quadrant chart, Sankey,
XY chart, block, kanban, requirement, architecture, C4, packet, radar and treemap. 

### Pie charts

A `pie` diagram is not drawn by Mermaid, whose pie has a fixed size and a legend that cannot be
styled. The plugin reads the same text, `pie [showData] [title …]` and one `"label" : value` line
for each positive slice, and draws a donut itself, in `src/pie.js`. The donut fills the card, with
the total in the centre and a legend of each slice's share, and of its value with `showData`.
Slices run from the largest to the smallest. Pointing at a slice or a legend row dims the others
and shows that slice's label and value in the centre. A legend longer than the card ends in
"+N more". A pie with no positive slice is passed to Mermaid, which reports the error. The pie's
SVG and PNG exports are drawn at 900 by 540. Its colours are the `--mm-series-*` colours, and its
text and surfaces come from the same stylesheet.

The plugin sets these Mermaid options. A diagram's own `%%{init: …}%%` directive or front matter
can change every one of them except `securityLevel` (a pie ignores them), which Mermaid keeps out of a diagram's reach:

| Option | Value | Why |
|---|---|---|
| `securityLevel` | `strict` | Mermaid sanitizes labels with DOMPurify and drops `click` callbacks. |
| `htmlLabels` | `false` | Labels are SVG text, so an exported SVG shows the same text in any viewer. |
| `layout` | `dagre` | The default layout of the diagrams that have a choice. See [Not included](#not-included). |
| `theme` | `base` | Every colour comes from `entry.css`. See [Colours](#colours). |
| `fontFamily` | the site's font | From the `theme` trait's `font-family` token, when the host gives one. |

## Colours

All colours are in `src/entry.css`, for each mode, as custom properties. The module sets the card's
`data-mode` and copies the host's colour tokens (`background`, `foreground`, `card`,
`card-foreground`, `border`, `accent`, `brand-main`, `brand-lighter`, `brand-darker` and the four
`alert-*` colours) to `--ws-<token>` properties, and the stylesheet gives each mode its defaults
for any token the host leaves out. It then reads the custom properties `--mm-<name>`, where
`<name>` is the kebab-case name of a Mermaid theme variable (`--mm-primary-color` is
`primaryColor`), and passes them to Mermaid's `base` theme. The twelve colours
`--mm-series-1` to `--mm-series-12` colour the slices of a pie, the sections of a timeline,
mindmap and journey, the branches of a git graph and the series of an XY chart.

To change how diagrams look, edit `entry.css` and nothing else. No colour is written in
`entry.js` or `diagram.js`. A diagram's own `themeVariables`, in a `%%{init: …}%%` directive or
front matter, still win over the stylesheet.

## What every card has

- **Fit, zoom and pan.** A diagram is fitted to the card, and shown at its own size when it is
  smaller than the card. Holding Ctrl or ⌘ while turning the mouse wheel, or pinching on a trackpad, zooms around the
  pointer. A plain wheel scrolls the dashboard. Dragging pans, and a double click fits the diagram again. A card that is resized keeps a fitted diagram fitted.
- **Links.** A link that the diagram declares, `click A href "https://example.com"`, is opened with
  the host command `core:ui:open-link`, which opens only `https:` and `mailto:` links, after the
  user confirms. `click` callbacks and HTML in labels are switched off.
- **Exports.** The card's Export entry offers *Diagram (SVG)*, *Diagram (PNG)* at twice the
  diagram's size (at most 8,192 pixels on a side), and *Source (Mermaid)* as an `.mmd` file. The SVG
  and the PNG are drawn on the stylesheet's `--mm-background`, in the mode that is showing. The source is
  offered even when the diagram could not be drawn.
- **Copilot context.** The AI agent reads the diagram's type, as Mermaid names it (`flowchart-v2`,
  `pie`), and its text, and the error when the diagram could not be drawn.
- **The diagram in the chat.** The widget is also an agent component. The AI agent shows a diagram
  under its answer from the text it writes (`diagram`, at most 20,000 characters), and the user can
  add the card to a dashboard. The plugin's skill, `skills/mermaid.md`, tells the agent which diagram
  type fits a question and the syntax that draws reliably.

## Not included

- **The ELK layout.** Mermaid 12.3 can lay out flowcharts, class, state and entity-relationship
  diagrams with ELK, and it defaults to it. The `elkjs` package is licensed EPL-2.0 or
  GPL-3.0-or-later, and this plugin bundles only permissive dependencies, so the build replaces the
  ELK code with a stub. The plugin sets `layout: dagre`, and a diagram that asks for ELK
  (`layout: elk`) shows "The ELK layout is not part of this plugin."
- **Icon packs.** An architecture diagram draws Mermaid's built-in icons. Registering an icon pack
  means fetching it, and the frame reaches no host.
- **A table of rows.** A widget that sets `raw` has no table view in this plugin, which draws
  diagrams only. Leave `raw` off.

## Model traits

The manifest declares no `model`, so the widget has the host's default traits. The module reads two:

| Trait | Purpose |
|---|---|
| `data` | The endpoint's answer: the diagram's text, or an object with `diagram`. |
| `theme` | The site's mode, its colour tokens and its `font-family`. |

## Permissions

| Permission | Used for |
|---|---|
| `core:data:read` | Reading the endpoint's answer. |
| `core:export:provide` | The Export entry. |
| `core:copilot:context` | The diagram's type and text for the AI agent. |
| `core:ui:open-link` | Opening a diagram's links after the user confirms. |

The manifest adds nothing to the frame's CSP. Mermaid runs without `eval`: the build replaces the
one `new Function` in Mermaid's d3-dsv dependency, which builds row objects for CSV parsing that
Mermaid never calls, with an equivalent function, and it fails when `entry.js` still contains
`eval(` or `new Function(`.

## Build

```bash
npm ci          # exact versions from package-lock.json
npm run build   # writes dist/mermaid/<version>/
npm run verify  # checks the package as Workspace's discovery does, prints its digest
```

The build bundles the plugin and Mermaid with its dependencies into the one module `entry.js`,
because a plugin frame loads a single module. It copies `entry.css`, the icon and the skill, writes
the licence of every bundled package into `assets/THIRD-PARTY-LICENSES.txt`, computes the checksum,
and writes `plugin.json` with `version` and `checksum`. It stops when a bundled package has a
licence that `build.mjs` has not cleared (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD and
DOMPurify's `MPL-2.0 OR Apache-2.0`), or no licence file.

The package Workspace consumes is the folder `dist/mermaid/<version>/`:

```
dist/mermaid/1.0.0/
  plugin.json                      manifest; version and checksum written by the build
  entry.js                         the AFM module (entry.module)
  entry.css                        the styles (entry.styles)
  assets/icon.svg                  the icon
  assets/THIRD-PARTY-LICENSES.txt  the licence of every bundled package
  skills/mermaid.md                the agent's skill
```

`npm run verify` prints the version digest a deployer pins in `WIDGET_PLUGINS_PINS`. Workspace's own
validator stays the authority, from a Workspace checkout's `backend-api/backend`:

```bash
python -m scripts.plugin_check <path>/dist/mermaid/<version>          # full check
python -m scripts.plugin_check --digest <path>/dist/mermaid/<version> # checksum and digest
```

Every change is a new version: raise `version` in `package.json` and build again. Workspace blocks a
version whose files change after it was discovered, and keeps it blocked.

## Test

```bash
npm test
```

The tests run in Node. `diagram.test.mjs` covers reading the diagram from an answer, the Mermaid
configuration, fitting, zooming and the export size. `widget.test.mjs` covers the exports and the
agent's context, and `manifest.test.mjs` the manifest. Drawing needs a browser: check a diagram on
a dashboard.

## Deploy

1. Copy `dist/mermaid/<version>/` into the plugins directory (`WIDGET_PLUGINS_DIR`), as
   `mermaid/<version>/`.
2. Where versions must be pinned, add the digest to `WIDGET_PLUGINS_PINS` as
   `"mermaid@<version>": "<digest>"`.
3. Admin, Widgets, Deployment: Rescan, review, approve, and enable the plugin. Grant it to the roles
   that may use it.
4. Add the data backend under Connections, and put its widgets on a dashboard.

## Try it on a local Workspace

```bash
npm ci && npm run build
WORKSPACE_PLUGINS_DIR=<plugins directory> npm run install:workspace
```

`install:workspace` runs `verify`, then copies `dist/mermaid/<version>/` to
`<plugins directory>/mermaid/<version>/`, next to the versions already there. It does nothing when
that version is already there with the same files, and refuses when its files differ: raise the
version instead. Then rescan and approve in Admin, Widgets, Deployment.

### Develop against a local Workspace

A local stack runs with `MODE=local`. On the plugin's Deployment page, **Patch**, **Minor** or
**Major** copies the active version to the next version number and marks the copy `development`.
The app serves that directory as it is, so a change needs no new version and no approval:

```bash
npm run build
WORKSPACE_PLUGINS_DIR=<plugins directory> WORKSPACE_PLUGIN_DEV_VERSION=<development version> npm run dev:workspace
```

`dev:workspace` replaces the files of the development version with the build and writes that
version into its `plugin.json`. A dashboard reads the plugin list when its window gets focus and
every minute, and a frame restarts when its files changed. When the version is ready, raise
`version` in `package.json` and install it as in the section above.
