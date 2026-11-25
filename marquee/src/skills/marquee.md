# Marquees with the Marquee component

Use the Marquee component (`marquee/marquee`) to show a strip of text that moves across the card: a few headlines, a short announcement, or figures such as prices. The user can add the card to a dashboard as a widget. Do not draw a ticker as HTML or as a table.

## The data

A strip of quotes, each with a name, a price, a change and a small chart:

```json
{
  "items": [
    { "ticker": "AAPL", "label": "Apple Inc.", "value": "185.32", "change": "+1.2%", "tone": "up", "spark": [181, 182, 181.5, 183, 184, 185.32] },
    { "ticker": "GOOGL", "label": "Alphabet Inc.", "value": "141.80", "change": "-0.5%", "tone": "down", "spark": [143, 142.6, 142, 141.9, 141.8] }
  ],
  "speed": 30
}
```

Headlines or a message are plain text items: `{ "items": ["Markets rally on earnings", "Fed holds rates steady"], "separator": " • " }`, or for one message `{ "text": "Maintenance tonight at 22:00", "behavior": "alternate" }`.

An item has these keys, all optional:

| Key | What it is |
|---|---|
| `ticker` | A short id such as `AAPL`. A live update names it to change that item alone. |
| `label` | The name of the thing, such as `Apple Inc.` or `S&P/TSX`. |
| `value` | The price or figure, as text such as `185.32`. |
| `change` | The change, as text such as `+1.2%` or `-549.32 -1.59%`. It takes the color of the `tone`. |
| `spark` | A small chart: 2 to 120 numbers, oldest first. It takes the color of the `tone`. |
| `text` | Plain text, for an item that is not a quote. |
| `html` | Simple inline HTML instead of `text`: `b`, `i`, `em`, `strong`, `span`, `code`, `small`, `a` and a few more. Scripts, images and anything else are removed. |
| `tone` | `up` (green), `down` (red) or `neutral` (muted). |
| `style` | CSS declarations such as `font-weight: bold`. Colors, fonts, padding, borders and sizes only. |
| `url` | An https or mailto link, which a click on the item opens after the user confirms. Needs `clickable`. |
| `clickValue` | What a click writes to the card's parameter, instead of the item's text. |

## The options

| Option | Values |
|---|---|
| `behavior` | `scroll` loops without end (default), `alternate` bounces, `slide` goes once and stops, `static` stays still and shows the items one after the other, each for `speed` seconds |
| `direction` | `left` (default), `right`, `up`, `down` |
| `speed` | 1 to 300 seconds for one cycle. Lower is faster. Default 15 |
| `gap` | 0 to 500 pixels between repeats. Default 50 |
| `separator` | Text after each item, for example ` • ` |
| `pauseOnHover` | Stop while the pointer is over the card. Default true |
| `paused` | Freeze: nothing moves and nothing updates until it is unpaused, and unpausing shows the current content |
| `clickable` | A click writes the clicked text to the parameter named by `clickParam` (default `value`) and opens the item's `url` |
| `disabled` | Dimmed and still, no clicks |
| `label`, `description`, `style` | A title before the strip, a tooltip, and CSS for the strip itself |

## Rules

- Keep a headline to about 80 characters. Give a price a `label`, a `value` and a `change`, and a `spark` when you have the recent prices: do not write them into one line of text.
- Give every quote a `ticker`, so that it can be updated later without sending the whole list.
- Use `tone` for a rise or a fall, not a color in `style`: the tones follow the light or dark mode, and they color the change and the chart.
- Up to 200 items. Say what you left out when there are more.
- `up` and `down` make a column of lines, one item to a line, and need a card that is taller than it is wide. A thin strip of one line needs `left` or `right`. When you change the direction of a card on a dashboard to `up` or `down`, tell the user that the card has to be made tall to show it.

## A marquee that is on a dashboard

A card on a dashboard gets its content and its options from its backend, the endpoint and the stream, so there is nothing for you to edit on it: show a new marquee with this component instead. A marquee whose backend streams updates changes by itself: the stream replaces the list, changes one ticker, or changes the speed and the pause. The Pause button of the card freezes it, the movement and the updates, until the user presses it again.
