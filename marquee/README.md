# Marquee for Workspace

A Workspace widget plugin that draws the `marquee` widget type: a strip of text, headlines or ticker items that moves across a card, in four directions and four behaviors, and that changes while it is on screen. Any backend whose `widgets.json` declares a widget of type `marquee` is drawn by this plugin once a Workspace deployment has approved and enabled it. The plugin has no plugin backend, no proxy and no secret, and its frame reaches no host.

Nothing in the plugin imports Workspace code. It talks to Workspace only through the widget plugin contract: `plugin.json`, the AFM module in `entry.js`, traits and host commands. The same built package serves FINOS Workspace and BQ Workspace. It needs a Workspace with card actions and the `core:data:stream` permission.

## The contract

The widget's endpoint returns text, a list of items, or an object. A backend declares the widget with its type and endpoint:

```json
{
  "headlines": {
    "name": "Headlines",
    "type": "marquee",
    "endpoint": "/headlines",
    "gridData": { "w": 40, "h": 3, "minH": 3 }
  }
}
```

Workspace takes the size of a backend widget from its `gridData`, and gives a widget that has none 20 columns and 10 rows, which leaves one line of content in the middle of a card three times too tall and half as wide as the dashboard. A strip of text is one line high: 40 columns and 3 rows, which is 95 pixels with the card's header. A strip of quotes has three lines, a name, a price and a change: 40 columns and 4 rows.

A marquee that moves `up` or `down` is a panel, a column of rows, so give it a card that is taller than it is wide, 10 columns and 16 rows for example:

```json
{
  "trending": {
    "name": "Trending tickers",
    "type": "marquee",
    "endpoint": "/trending",
    "data": { "streamEndpoint": "/ws/trending" },
    "gridData": { "w": 10, "h": 16 }
  }
}
```

| The endpoint returns | The marquee shows |
|---|---|
| `"Markets rally"` | One item of text. |
| `["Markets rally", "Fed holds rates"]` | One item for each entry. |
| `{"items": [...], "speed": 20}` | The items, drawn with the options of the object. |
| `{"text": "Markets rally", "behavior": "alternate"}` | One item of text, drawn with the options. |

An item is a string or an object. A string is text, unless it has both `<` and `>`, when it is read as simple inline HTML. An object has these keys, all optional:

| Key | What it is |
|---|---|
| `ticker` | A short id such as `AAPL`. A live update names it to change that item alone. |
| `label` | The name of the thing, such as `Apple Inc.` or `S&P/TSX`. |
| `value` | The price or figure, as text or a number: `185.32`. |
| `change` | The change, as text: `+1.2%` or `-549.32 -1.59%`. It takes the color of the `tone`. |
| `spark` | A small chart: 2 to 120 numbers, oldest first. It takes the color of the `tone`. |
| `text` | Plain text, for an item that is not a quote. |
| `html` | Simple inline HTML, which wins over `text`. |
| `tone` | `up` (green), `down` (red) or `neutral` (muted), from the theme's own colors. |
| `style` | CSS declarations such as `font-weight: bold`. |
| `url` | An https or mailto link that a click on the item opens, after the user confirms. |
| `clickValue` | What a click writes to the card's parameter, instead of the item's text. |

An item with a `label`, a `value`, a `change` or a `spark` is a quote, and it is drawn as one in both layouts:

- In a strip, a quote is a block of three lines, the name, the price and the change, with its chart at the right. Quotes follow each other with the space of a gap and no separator.
- In a panel, a quote is a row: the ticker and, under it, the name at the left, the chart in the middle, the price and, under it, the change at the right. The columns are shared by all the rows, so the charts and the prices line up, and a thin line separates the rows. In a card narrower than 260 pixels the charts go, and in one narrower than 170 pixels the names go too.

An item that has only `text` is a line of text: in a strip it is colored by its `tone`, and in a panel it is a row of its own. The gap between the repeats of a panel is 0, so that the rows go on without a break.

The endpoint gets `theme=dark` or `theme=light` in its query, which carries the site's mode, and is asked again when the user switches it. A response that is none of these shows "The endpoint did not return text, a list of items or a marquee object."

### The options

An object response, the chat artifact and a live message all take the same options.

| Option | Values | Default |
|---|---|---|
| `behavior` | `scroll` loops without end, `alternate` bounces between the two edges, `slide` enters from one edge and stops at the other, `static` stays still and shows the items one after the other | `scroll` |
| `direction` | `left`, `right`, `up`, `down` | `left` |
| `speed` | 1 to 300 seconds for one cycle, or for each item when `static`. Lower is faster | 15 |
| `gap` | 0 to 500 pixels between the repeats of the content | 50, or 0 when the content moves `up` or `down` |
| `separator` | Text after each item, such as ` • ` | none |
| `pauseOnHover` | Stop while the pointer is over the card | `true` |
| `paused` | Freeze the marquee: it stops moving and stops updating, and keeps showing what it showed when it was paused. Unpausing shows the current content | `false` |
| `clickable` | A click writes the clicked item's text, or its `clickValue`, to the card's parameter and opens the item's `url` | `false` |
| `clickParam` | The widget parameter that receives the clicked text | `value` |
| `disabled` | Dimmed and still, and ignores clicks | `false` |
| `label` | A short title before the marquee | none |
| `description` | A tooltip, also the accessible name | none |
| `style` | CSS for the strip itself | none |

A marquee that scrolls repeats its content as often as the card needs, so that there is never a gap at the edge, and it fades at both ends. A `static` marquee with several items shows one at a time. A vertical marquee puts every item on its own line.

A `style` takes colors, fonts, padding, borders, sizes and opacity, and nothing else: a value with a URL, a comment, a quote, a backslash or a function other than the color, gradient and math functions is dropped, and so is a property that is not on the list. The same holds for the `style` of an item, and for a `style` attribute in HTML.

### Simple HTML

`html` and a string with markup are cleaned with DOMPurify before they are drawn. These elements stay: `a`, `abbr`, `b`, `bdi`, `br`, `cite`, `code`, `del`, `em`, `i`, `ins`, `kbd`, `mark`, `q`, `s`, `small`, `span`, `strong`, `sub`, `sup`, `time`, `u` and `wbr`. They keep `title`, `lang`, `dir`, `datetime`, a `style` that passes the rule above, an `href` that is https or mailto, and a `class` of `up`, `down` or `neutral`, which is a tone. Scripts, handlers, images, frames, forms, SVG and every other attribute are removed. A link is opened by Workspace after the user confirms, never by the frame.

## Live updates

A marquee changes while it is on screen in three ways.

**A stream.** A widget that sets `data.streamEndpoint` and a plugin with `core:data:stream` get a WebSocket, which Workspace opens through its API so that the browser never holds the backend's credentials. The marquee reads these JSON messages:

| Message | What it does |
|---|---|
| `{"op": "set-content", "text": "..."}` | Replaces the content with one item of plain text. `html` gives one item of simple HTML, `items` gives a list. |
| `{"op": "set-content", "speed": 8, "paused": true, "separator": " • "}` | Changes options. Any option of the table above is allowed, with or without content. |
| `{"op": "set-item", "ticker": "AAPL", "value": "186.25", "change": "+1.8%", "tone": "up", "spark": [...]}` | Changes the item with that ticker and leaves the others. `label`, `text`, `html`, `style`, `url` and `clickValue` are allowed too. `text` or `html` turns a quote into text, and a `value`, `change` or `label` turns text into a quote. A ticker that the list does not have is added at the end. |
| `{"op": "remove-item", "ticker": "AAPL"}` | Removes the item. |

Messages arrive in batches, in order. A change of the content of items that keep their tickers is written in place, so the animation does not restart and the content does not jump, and an item whose text, price or change changed flashes in its own color for a moment (not with reduced motion). A new chart alone does not flash. A change of the speed keeps the position in the cycle. A message that is not understood is ignored.

The dot at the right edge shows the stream: green when it is live, amber while it connects or retries, which Workspace does with a growing delay. The card's Refresh drops what the stream changed and reconnects.

**The endpoint.** `refetchInterval` in `widgets.json` makes Workspace ask the endpoint again, and the card follows each answer:

```json
{ "prices": { "name": "Prices", "type": "marquee", "endpoint": "/prices", "refetchInterval": 5000 } }
```

A new answer replaces what a stream put in the content.

**The chat.** The widget declares an `artifact`, so that the AI agent can show a marquee under its answer with any of the options. The user adds the card to a dashboard, where it keeps its data. The `marquee` skill (`src/skills/marquee.md`) tells the agent the shape.

When two of these set the same thing, the order is: a live message, the answer of the endpoint, the default.

### Clicks

With `clickable`, a click on an item writes the item's `clickValue`, or its text (a quote's text is its ticker, name, price and change), to the widget parameter named by `clickParam`, `value` unless it says otherwise. Workspace then asks the endpoint again with that parameter, and the parameter can be linked to other widgets in a group, as any other. A click on a gap or a separator writes the text of all the items. Enter and Space do the same on a marquee that has the focus. When the widget declares no such parameter, nothing is written. A click on an item that has a `url` also asks Workspace to open it.

```json
{
  "ticker": {
    "name": "Ticker",
    "type": "marquee",
    "endpoint": "/ticker",
    "params": [{ "paramName": "value", "type": "text", "label": "Clicked", "value": "", "show": true }]
  }
}
```

## What every card has

- **Pause.** A button in the card's header. It freezes the marquee: the content stops moving and stops updating, and a *Paused* tag shows in the card. Messages of a stream and answers of the endpoint that arrive meanwhile are kept, and the next press shows the current content. A message that sets `paused` and the card's Refresh also end the pause. Hovering with `pauseOnHover` stops the movement only.
- **Exports.** *Items (JSON)*, *Items (CSV)* and *Text (TXT)*: the items that the card shows now, with the text of HTML items, and a quote's text being its ticker, name, price and change. A cell that starts with `=`, `+`, `-` or `@` is written with a leading quote so that a spreadsheet does not run it.
- **Agent context.** The AI agent reads the text, up to a hundred items, the options in force and the state of the stream.
- **Accessibility.** The strip has the role `marquee` and is not a live region, so a reader is not interrupted. Only the first copy of the content is read, and separators are hidden. With `prefers-reduced-motion` the strip does not move, shows one copy and can be scrolled. A clickable strip can be focused.
- **Colors.** The text, the tones and the dot follow the site's light or dark mode and its font, and change with it.

## Permissions

| Permission | Used for |
|---|---|
| `core:data:read` | The endpoint's answer. |
| `core:data:stream` | The stream of `data.streamEndpoint`. |
| `core:params:write` | The click's parameter. |
| `core:export:provide` | The export dialog. |
| `core:copilot:context` | What the AI agent reads about the card. |
| `core:ui:open-link` | A link in the content, or an item's `url`. |
| `core:ui:button` | The Pause button. |

## Model traits

`data`, `params` (written by a click), `theme` and `capabilities`. The widget has no settings and no `definition`: everything that it takes comes in the answer, the stream or the artifact.

## Build

Node 20 or later (CI runs 26.12.1). The one dependency is `dompurify`; `esbuild` bundles the module.

```bash
npm ci --ignore-scripts
npm run build
npm run verify
```

The build writes `dist/marquee/<version>/`, with the version from `package.json`: `entry.js` (about 46 KiB), `entry.css`, `assets/icon.svg`, `assets/pause.svg`, `assets/THIRD-PARTY-LICENSES.txt`, `skills/marquee.md` and `plugin.json`, the manifest with the version and the checksum. `npm run verify` checks the package as Workspace's discovery does and prints the version digest.

## Test

```bash
npm test
```

The unit tests cover the style and value rules, the reading of items and documents, the order of the layers, every live message, the pause, the sanitizer against known payloads, the view (copies, travel, cycling, in-place updates, clicks, accessibility) and the manifest, which they tie to the module: every artifact property is one that the module reads, and the skill names them all.

A Playwright suite runs against a running Workspace stack with a small backend of its own, `e2e/backend.mjs`, which serves four widgets and a WebSocket:

```bash
E2E_USER_EMAIL=<superuser> E2E_USER_PASSWORD=<password> npm run e2e
```

It signs in, creates a role, a backend and a dashboard, and removes them again. It checks that the stack serves the build under test, the size of the cards, the quote strip and the vertical ticker panel (its rows, its lined-up columns, its fade), the animation and its direction for every direction, alternate, slide and static, the stream (changes in place with a flash, additions, removals, drops and reconnects, bad messages), the polled endpoint, clicks and the parameter, hostile markup, the link confirmation, the exports, light and dark mode, reduced motion, and the Pause button freezing the movement and the updates. The plugin must be approved and enabled on that stack, as below. `E2E_BASE_URL` (default `http://localhost:1420`), `E2E_API_URL` (`http://localhost:8000`), `E2E_BACKEND_PORT`, `E2E_BACKEND_HOST` and `E2E_CHROMIUM` (a Chromium executable) name the stack and the browser.

## Deploy

The package Workspace consumes is the folder `dist/marquee/<version>/`.

1. Copy it into the plugins directory as `marquee/<version>/`, or run `WORKSPACE_PLUGINS_DIR=<plugins directory> npm run install:workspace`.
2. Where versions must be pinned, add the digest that `npm run verify` prints to `WIDGET_PLUGINS_PINS` as `"marquee@<version>": "<digest>"`.
3. Admin, Widgets, Deployment: Rescan, review what the version asks for, approve it, and enable it for the organization. Then, under Roles, grant it to the roles that may use it: a role is the only way to a plugin.

Every change is a new version: raise `version` in `package.json` and build again. Workspace blocks an approved version whose files change. On a local stack, **Patch** on the plugin's Deployment page starts the next version as a development version, and `WORKSPACE_PLUGINS_DIR=<plugins directory> WORKSPACE_PLUGIN_DEV_VERSION=<x.y.z> npm run dev:workspace` overwrites its files with the build, so a reload of the dashboard shows the change.

## Try it

`node e2e/backend.mjs 8012` serves five widgets, with prices that tick over the WebSocket. Connect `http://host.docker.internal:8012` as a backend under Connections, then add *E2E marquee text*, *E2E marquee polled*, *E2E marquee live* (the quote strip), *E2E marquee click* and *E2E marquee vertical* (the ticker panel) to a dashboard.
