import { Panel } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import {
  ACCENTS,
  isLink,
  MAX_EDGE_LABEL,
  MAX_LABEL,
  MAX_NOTE,
  MAX_URL,
  NODE_SHAPES,
  type Accent,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type NodeShape,
} from "./graph.ts";

export type Target = { kind: "node"; node: FlowNode } | { kind: "edge"; edge: FlowEdge };

interface BarProps {
  target: Target;
  onNode: (patch: Partial<FlowNode>) => void;
  onEdge: (patch: Partial<FlowEdge>) => void;
  onDelete: () => void;
  warn: (text: string) => void;
}

const SHAPE_LABELS: Record<NodeShape, string> = {
  rectangle: "Rectangle",
  rounded: "Rounded",
  pill: "Pill",
  diamond: "Decision",
  circle: "Circle",
};

const ACCENT_LABELS: Record<Accent, string> = {
  neutral: "Neutral",
  brand: "Brand",
  positive: "Positive",
  negative: "Negative",
  warning: "Warning",
  info: "Info",
};

const ENDS: { kind: NodeKind; label: string; title: string }[] = [
  { kind: "input", label: "Start", title: "Start: arrows leave this box and none enter it" },
  { kind: "default", label: "Middle", title: "Middle: arrows enter and leave this box" },
  { kind: "output", label: "End", title: "End: arrows enter this box and none leave it" },
];

const SHAPE_ICONS: Record<NodeShape, React.ReactNode> = {
  rectangle: <rect x="2" y="4" width="12" height="8" />,
  rounded: <rect x="2" y="4" width="12" height="8" rx="2.5" />,
  pill: <rect x="1.5" y="5" width="13" height="6" rx="3" />,
  diamond: <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" />,
  circle: <circle cx="8" cy="8" r="6" />,
};

function TextField(props: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onCommit: (value: string) => boolean;
}) {
  const { label, value, placeholder, maxLength, onCommit } = props;
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    if (draft !== value && !onCommit(draft)) setDraft(value);
  };

  return (
    <label className="flow-field">
      <span>{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function Group(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flow-bar-group" role="group" aria-label={props.label}>
      {props.children}
    </div>
  );
}

function Toggle(props: { label: string; title: string; pressed: boolean; onChange: (pressed: boolean) => void }) {
  return (
    <button
      type="button"
      className="flow-bar-button flow-bar-text"
      aria-pressed={props.pressed}
      title={props.title}
      onClick={() => props.onChange(!props.pressed)}
    >
      {props.label}
    </button>
  );
}

function Swatches(props: { value: Accent; onPick: (accent: Accent) => void }) {
  return (
    <Group label="Colour">
      {ACCENTS.map((accent) => (
        <button
          key={accent}
          type="button"
          className="flow-bar-button flow-swatch"
          aria-label={`Colour: ${ACCENT_LABELS[accent]}`}
          aria-pressed={props.value === accent}
          title={ACCENT_LABELS[accent]}
          data-flow-accent={accent}
          onClick={() => props.onPick(accent)}
        >
          <span style={{ background: `var(--flow-accent-${accent})` }} />
        </button>
      ))}
    </Group>
  );
}

function NodeFields({ node, onNode, warn }: { node: FlowNode; onNode: BarProps["onNode"]; warn: BarProps["warn"] }) {
  return (
    <>
      <div className="flow-bar-row">
        <TextField
          label="Label"
          value={node.label}
          placeholder="Text in the box"
          maxLength={MAX_LABEL}
          onCommit={(label) => {
            if (!label.trim()) return false;
            onNode({ label });
            return true;
          }}
        />
        <TextField
          label="Note"
          value={node.note ?? ""}
          placeholder="Second line"
          maxLength={MAX_NOTE}
          onCommit={(note) => {
            onNode({ note });
            return true;
          }}
        />
        <TextField
          label="Link"
          value={node.url ?? ""}
          placeholder="https:// or mailto:"
          maxLength={MAX_URL}
          onCommit={(url) => {
            if (url.trim() && !isLink(url.trim())) {
              warn("A link opens only if it starts with https: or mailto:");
              return false;
            }
            onNode({ url });
            return true;
          }}
        />
      </div>
      <div className="flow-bar-row">
        <Group label="Shape">
          {NODE_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              className="flow-bar-button flow-shape-button"
              aria-label={`Shape: ${SHAPE_LABELS[shape]}`}
              aria-pressed={(node.shape ?? "rounded") === shape}
              title={SHAPE_LABELS[shape]}
              data-flow-shape={shape}
              onClick={() => onNode({ shape })}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                {SHAPE_ICONS[shape]}
              </svg>
            </button>
          ))}
        </Group>
        <Swatches value={node.accent ?? "neutral"} onPick={(accent) => onNode({ accent })} />
        <Group label="Arrows">
          {ENDS.map(({ kind, label, title }) => (
            <button
              key={kind}
              type="button"
              className="flow-bar-button flow-bar-text"
              aria-pressed={(node.kind ?? "default") === kind}
              title={title}
              data-flow-kind={kind}
              onClick={() => onNode({ kind })}
            >
              {label}
            </button>
          ))}
        </Group>
      </div>
    </>
  );
}

function EdgeFields({ edge, onEdge }: { edge: FlowEdge; onEdge: BarProps["onEdge"] }) {
  return (
    <>
      <div className="flow-bar-row">
        <TextField
          label="Label"
          value={edge.label ?? ""}
          placeholder="Text on the arrow"
          maxLength={MAX_EDGE_LABEL}
          onCommit={(label) => {
            onEdge({ label });
            return true;
          }}
        />
      </div>
      <div className="flow-bar-row">
        <Swatches value={edge.accent ?? "neutral"} onPick={(accent) => onEdge({ accent })} />
        <Group label="Line">
          <Toggle label="Dashed" title="Draw the arrow as a dashed line" pressed={edge.dashed === true} onChange={(dashed) => onEdge({ dashed })} />
          <Toggle label="Moving" title="Move the dashes along the arrow" pressed={edge.animated === true} onChange={(animated) => onEdge({ animated })} />
          <Toggle label="Head" title="Draw the arrow head" pressed={edge.arrow !== false} onChange={(arrow) => onEdge({ arrow })} />
        </Group>
      </div>
    </>
  );
}

export function SelectionBar({ target, onNode, onEdge, onDelete, warn }: BarProps) {
  return (
    <Panel position="bottom-center" className="flow-bar nodrag nopan nowheel" data-flow-bar={target.kind}>
      <div className="flow-bar-fields">
        {target.kind === "node" ? (
          <NodeFields node={target.node} onNode={onNode} warn={warn} />
        ) : (
          <EdgeFields edge={target.edge} onEdge={onEdge} />
        )}
      </div>
      <button
        type="button"
        className="flow-bar-button flow-bar-delete"
        aria-label={target.kind === "node" ? "Delete the box" : "Delete the arrow"}
        title="Delete"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 4.5h11" />
          <path d="M6 4.5V3h4v1.5" />
          <path d="M4 4.5l.7 8.5h6.6l.7-8.5" />
        </svg>
      </button>
    </Panel>
  );
}
