import { isQuote, plainText, shownText } from "./model.js";

export const MAX_COPIES = 40;
const SVG = "http://www.w3.org/2000/svg";

const AXIS = { left: "x", right: "x", up: "y", down: "y" };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function statusText(event) {
  if (event.state === "live") return "Live";
  if (event.state === "retrying") return `Disconnected, retrying in ${event.retryIn} s`;
  if (event.state === "closed") return "Closed";
  return "Connecting…";
}

export function createView(host, { sanitize, onSelect, onOpen }) {
  const doc = host.ownerDocument;
  const make = (tag, className, parent) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  };

  const root = make("div", "mq", host);
  const label = make("span", "mq-label", root);
  const stage = make("div", "mq-stage", root);
  const track = make("div", "mq-track", stage);
  const message = make("div", "mq-message", root);
  const paused = make("span", "mq-paused", root);
  const dot = make("span", "mq-dot", root);
  stage.setAttribute("role", "marquee");
  label.hidden = true;
  message.hidden = true;
  paused.hidden = true;
  paused.textContent = "Paused";
  dot.hidden = true;

  let state = null;
  let template = null;
  let signature = "";
  let copies = 1;
  let hovering = false;
  let index = 0;
  let timer = null;
  let cycleKey = "";
  let speed = null;
  let flip = false;
  let appliedStyle = [];

  const entries = () =>
    state.behavior === "static"
      ? state.items.slice(index, index + 1).map((item) => ({ item, i: index }))
      : state.items.map((item, i) => ({ item, i }));

  const signatureOf = () =>
    JSON.stringify([
      state.behavior,
      state.direction,
      state.separator,
      state.behavior === "static" ? index : 0,
      state.items.map((item) => item.ticker ?? null),
    ]);

  function spark(values) {
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("class", "mq-spark");
    svg.setAttribute("viewBox", "0 0 100 30");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const low = Math.min(...values);
    const span = Math.max(...values) - low || 1;
    const points = values.map((value, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(28 - ((value - low) / span) * 26).toFixed(2)}`);
    const line = doc.createElementNS(SVG, "polyline");
    line.setAttribute("points", points.join(" "));
    svg.append(line);
    return svg;
  }

  function quote(item) {
    const info = make("span", "mq-info");
    const named = Boolean(item.ticker && item.label);
    const first = item.ticker ?? item.label;
    const parts = [];
    if (first) parts.push(["mq-tick", first]);
    if (named) parts.push(["mq-name", item.label]);
    if (item.value) parts.push(["mq-price", item.value]);
    if (item.change) parts.push(["mq-change", item.change]);
    for (const [className, text] of parts) {
      const line = make("span", className, info);
      line.textContent = text;
    }
    return item.spark ? [info, spark(item.spark)] : [info];
  }

  function fill(node, item) {
    const quoted = !item.html && isQuote(item);
    node.className = ["mq-item", quoted && "mq-quote", quoted && item.ticker && item.label && "has-name", item.tone && `mq-tone-${item.tone}`].filter(Boolean).join(" ");
    if (item.html) node.replaceChildren(doc.importNode(sanitize(item.html), true));
    else if (quoted) node.replaceChildren(...quote(item));
    else node.replaceChildren(doc.createTextNode(item.text ?? ""));
    node.removeAttribute("style");
    for (const [property, value] of Object.entries(item.style ?? {})) node.style.setProperty(property, value);
  }

  function buildContent() {
    const content = make("span", "mq-content");
    const separator = state.behavior === "static" ? "" : state.separator;
    for (const { item, i } of entries()) {
      const node = make("span", "", content);
      node.dataset.i = String(i);
      fill(node, item);
      if (separator) {
        const mark = make("span", "mq-sep", content);
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = separator;
      }
    }
    return content;
  }

  function copy(hidden) {
    const node = template.cloneNode(true);
    if (hidden) {
      node.classList.add("mq-clone");
      node.setAttribute("aria-hidden", "true");
    }
    return node;
  }

  function mount(count) {
    if (state.behavior === "scroll") {
      const groups = [0, 1].map((g) => {
        const group = make("span", "mq-group");
        for (let n = 0; n < count; n += 1) group.append(copy(g > 0 || n > 0));
        return group;
      });
      track.replaceChildren(...groups);
    } else track.replaceChildren(copy(false));
    copies = count;
  }

  function rebuild() {
    template = buildContent();
    signature = signatureOf();
    mount(1);
  }

  function travel(size, extent) {
    const far = size - extent;
    const forward = state.direction === "left" || state.direction === "up";
    let from;
    let to;
    if (state.behavior === "alternate") {
      const low = Math.min(0, far);
      const high = Math.max(0, far);
      [from, to] = forward ? [high, low] : [low, high];
    } else if (forward) {
      from = size;
      to = extent <= size ? 0 : far;
    } else {
      from = -extent;
      to = extent <= size ? far : 0;
    }
    track.style.setProperty("--mq-from", `${from}px`);
    track.style.setProperty("--mq-to", `${to}px`);
  }

  function settle() {
    if (!state || state.problem) return;
    const vertical = AXIS[state.direction] === "y";
    const size = vertical ? stage.clientHeight : stage.clientWidth;
    if (!size) return;
    const first = track.querySelector(".mq-content");
    const extent = first ? (vertical ? first.offsetHeight : first.offsetWidth) : 0;
    if (state.behavior === "scroll") {
      const need = extent > 0 ? clamp(Math.ceil(size / extent), 1, MAX_COPIES) : 1;
      if (need !== copies) mount(need);
    } else if (state.behavior === "alternate" || state.behavior === "slide") travel(size, extent);
  }

  function setSpeed(next) {
    if (speed === next) return;
    const animation = track.getAnimations?.()?.[0];
    let progress = null;
    if (animation && speed) {
      const total = speed * 1000;
      const elapsed = Number(animation.currentTime) || 0;
      progress = state.behavior === "slide" ? Math.min(1, elapsed / total) : (elapsed % total) / total;
    }
    speed = next;
    track.style.animationDuration = `${next}s`;
    if (animation && progress !== null) animation.currentTime = progress * next * 1000;
  }

  function paint() {
    root.dataset.axis = AXIS[state.direction];
    root.dataset.direction = state.direction;
    root.dataset.behavior = state.behavior;
    root.classList.toggle("is-paused", state.paused || state.disabled);
    root.classList.toggle("is-pausable", state.pauseOnHover);
    root.classList.toggle("is-clickable", state.clickable && !state.disabled);
    root.classList.toggle("is-disabled", state.disabled);
    root.classList.toggle("has-problem", Boolean(state.problem));
    root.style.setProperty("--mq-gap", `${state.gap}px`);
    setSpeed(state.speed);
    label.textContent = state.label;
    label.hidden = !state.label || Boolean(state.problem);
    const name = state.description || state.label;
    if (state.description) stage.setAttribute("title", state.description);
    else stage.removeAttribute("title");
    if (name) stage.setAttribute("aria-label", name);
    else stage.removeAttribute("aria-label");
    if (state.clickable && !state.disabled) stage.setAttribute("tabindex", "0");
    else stage.removeAttribute("tabindex");
    for (const property of appliedStyle) root.style.removeProperty(property);
    appliedStyle = Object.keys(state.style ?? {});
    for (const [property, value] of Object.entries(state.style ?? {})) root.style.setProperty(property, value);
    message.textContent = state.problem ?? "";
    message.hidden = !state.problem;
    stage.hidden = Boolean(state.problem);
    paused.hidden = !state.paused || Boolean(state.problem);
  }

  function patch(previous) {
    flip = !flip;
    state.items.forEach((item, i) => {
      const before = previous.items[i];
      if (JSON.stringify(item) === JSON.stringify(before)) return;
      const changed = shownText(item) !== (before ? shownText(before) : null);
      for (const node of track.querySelectorAll(`[data-i="${i}"]`)) {
        fill(node, item);
        if (changed) node.classList.add(flip ? "mq-flash-a" : "mq-flash-b");
      }
      for (const node of template.querySelectorAll(`[data-i="${i}"]`)) fill(node, item);
    });
  }

  function advance() {
    if (!state || state.paused || state.disabled || (state.pauseOnHover && hovering)) return;
    index = (index + 1) % state.items.length;
    rebuild();
    settle();
  }

  function cycle() {
    const key = JSON.stringify([state.behavior, state.speed, state.items.length > 1, Boolean(state.problem)]);
    if (key === cycleKey) return;
    cycleKey = key;
    clearInterval(timer);
    timer = null;
    if (state.problem || state.behavior !== "static" || state.items.length < 2) return;
    timer = setInterval(advance, state.speed * 1000);
  }

  function whole() {
    return [...template.querySelectorAll("[data-i]")]
      .map((node) => {
        const item = state.items[Number(node.dataset.i)];
        return item && !item.html ? plainText(item) : (node.textContent ?? "").trim();
      })
      .filter(Boolean)
      .join(" ");
  }

  function select(event) {
    const anchor = event.target.closest?.("a[href]");
    if (anchor) {
      event.preventDefault();
      onOpen(anchor.getAttribute("href"));
      return;
    }
    if (!state?.clickable || state.disabled || !template) return;
    const node = event.target.closest?.("[data-i]");
    const item = node ? (state.items[Number(node.dataset.i)] ?? null) : null;
    onSelect({ item, text: item && !item.html ? plainText(item) : node ? (node.textContent ?? "").trim() : whole() });
  }

  const onKey = (event) => {
    if ((event.key !== "Enter" && event.key !== " ") || !state?.clickable || state.disabled || !template) return;
    event.preventDefault();
    onSelect({ item: null, text: whole() });
  };

  const hover = (on) => {
    hovering = on;
    root.classList.toggle("is-hovered", on);
  };
  stage.addEventListener("pointerenter", () => hover(true));
  stage.addEventListener("pointerleave", () => hover(false));
  stage.addEventListener("pointercancel", () => hover(false));
  stage.addEventListener("click", select);
  stage.addEventListener("keydown", onKey);

  return {
    root,
    stage,
    track,
    update(next) {
      const previous = state;
      state = next;
      index = next.items.length ? index % next.items.length : 0;
      paint();
      if (next.problem) {
        signature = "";
        template = null;
        track.replaceChildren();
      } else if (!previous || previous.problem || signatureOf() !== signature) rebuild();
      else patch(previous);
      cycle();
      settle();
    },
    resize: settle,
    setStream(event) {
      if (!event) {
        dot.hidden = true;
        return;
      }
      dot.hidden = false;
      dot.dataset.state = event.state;
      const text = statusText(event);
      dot.setAttribute("title", text);
      dot.setAttribute("aria-label", text);
      dot.setAttribute("role", "img");
    },
    destroy() {
      clearInterval(timer);
      timer = null;
      root.remove();
    },
  };
}
