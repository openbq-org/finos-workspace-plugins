# Diagrams with the Mermaid component

Use the Mermaid component (`mermaid/diagram`) to show a diagram in the conversation, drawn from Mermaid text. The user can add the card to a dashboard as a widget, so keep the diagram self-explanatory.

## Choose the diagram

| The question | Start the text with |
|---|---|
| Steps, decisions, a process | `flowchart TD` (top down) or `flowchart LR` (left to right) |
| Who calls whom, in order | `sequenceDiagram` |
| Types and how they relate | `classDiagram` |
| States and transitions | `stateDiagram-v2` |
| Tables and their keys | `erDiagram` |
| A schedule or plan over time | `gantt` |
| Shares of a whole | `pie` |
| An idea broken into branches | `mindmap` |
| Events in time order | `timeline` |
| Branches and commits | `gitGraph` |

## The data

```json
{ "diagram": "flowchart LR\n  A[Request] --> B{Valid?}\n  B -- yes --> C[Process]\n  B -- no --> D[Reject]" }
```

`diagram` is the Mermaid text and nothing else: no code fence, no explanation.

## Rules

- Give every node a short id (`A`, `api`, `db`) and put the words in a label: `api[Orders API]`.
- Put a label in double quotes when it has parentheses, brackets, colons, quotes or slashes: `A["Cost (USD): 10"]`.
- Never name a node `end` in lower case; write `End` or `finish`.
- Start with `flowchart` and not `graph`, and leave a space around every arrow.
- Keep a diagram to about 40 nodes and 20,000 characters. When there is more, draw the overview and say what you left out.
- Do not set colors, themes or an `init` directive. The diagram is drawn in the workspace's light or dark mode, and again when the mode changes.
- Do not use `click` callbacks or HTML in labels: they are switched off. A link, `click A href "https://example.com"`, opens after the user confirms, and only for https and mailto addresses.
- Dates in a `gantt` are `YYYY-MM-DD`.
- Say what the diagram shows and what stands out; do not describe every box.
