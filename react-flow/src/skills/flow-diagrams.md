# Flow diagrams with the React Flow component

Use the React Flow component (`react-flow/flow`) to show boxes and the arrows between them: the steps of a process, a decision tree, a data pipeline, a dependency map or the systems in an architecture. Use it when the order, the branching or the dependency is the point. A list is better for things that have no order, and a chart is better for numbers.

The user can add the card to a dashboard as a widget, so make the diagram readable on its own.

## The data

```json
{
  "title": "Order handling",
  "direction": "LR",
  "nodes": [
    { "id": "in", "label": "Order received", "kind": "input", "shape": "pill" },
    { "id": "check", "label": "In stock?", "shape": "diamond" },
    { "id": "ship", "label": "Ship", "accent": "positive", "kind": "output" },
    { "id": "back", "label": "Back order", "note": "Wait for stock", "accent": "warning", "kind": "output" }
  ],
  "edges": [
    { "source": "in", "target": "check" },
    { "source": "check", "target": "ship", "label": "yes" },
    { "source": "check", "target": "back", "label": "no", "dashed": true }
  ]
}
```

## Rules

- Leave `x` and `y` out. The diagram is laid out for you, in the `direction` you ask for: `TB` (top to bottom, the default), `LR`, `BT` or `RL`. Give `x` and `y` on every node or on none; a partly placed diagram is laid out again from scratch.
- Give every node a short `id` that the edges use, and put the words in `label`. An edge whose `source` or `target` is not a node is dropped, and a repeated `id` is dropped.
- `kind` says where the arrows attach: `input` for a node that only starts a flow, `output` for one that only ends it, `default` (the default) for both.
- `shape` is `rounded` (the default), `rectangle`, `pill`, `diamond` or `circle`. Use `diamond` for a question and `pill` for a start or an end.
- `accent` is `neutral` (the default), `brand`, `positive`, `negative`, `warning` or `info`. It takes the colour from the site's theme, so do not ask for a colour of your own. Use it to mean something: `positive` for a success path, `negative` for a failure.
- `note` is a second, smaller line under the label. Keep it short.
- `url` makes the box open a link, which the user confirms first. Only `https:` and `mailto:` addresses open.
- An edge is a plain line with an arrow head. `label` writes on it, `dashed` draws it broken, `animated` moves the dashes, and `arrow: false` leaves the head off.
- Keep a diagram to about 40 nodes. The hard limits are 300 nodes, 600 edges and 24,000 characters of JSON once it is saved; a larger diagram is not saved. Draw the overview and say what you left out.
- Say what the diagram shows and what stands out. Do not read out every box.

## Changing a diagram that is on a dashboard

The diagram is the widget's `graph` setting, a JSON string. Both the user and you write it:

1. `read_widget` gives the current diagram as `ui_args.config.graph`. When it is empty the widget is showing what its endpoint returns.
2. Parse that string, change the nodes and edges, and write the whole diagram back with `update_widget`, as `config.graph` with the JSON encoded as a string.
3. Keep each node's `x` and `y` when you change a diagram the user has arranged, so the boxes stay where they put them. Leave them out only when you want the diagram laid out again.

The user moves, connects, renames, adds and deletes boxes on the card, and sets a box's shape, colour, note, link and ends and an arrow's label, colour and line with the bar that opens when they select one. Every change is saved to the same setting, so read it again before you change it, and leave the fields you are not changing as they are.
