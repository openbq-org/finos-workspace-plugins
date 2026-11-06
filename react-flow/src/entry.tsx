import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MAX_GRAPH_CHARS,
  parseGraph,
  serializeGraph,
  type Direction,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
} from "./graph.ts";
import type { AnyModel, Experimental, RenderContext, WidgetModule } from "./host.ts";
import { freeSpot, layout, sizeOf, type Box } from "./layout.ts";
import { cssVariables, modeOf, type ThemeTrait } from "./theme.ts";

interface NodeData extends Record<string, unknown> {
  node: FlowNode;
  direction: Direction;
  rename: (id: string, label: string) => void;
  open: (url: string) => void;
}

type FlowNodeType = Node<NodeData, "flow">;

const HANDLES: Record<Direction, { source: Position; target: Position }> = {
  TB: { source: Position.Bottom, target: Position.Top },
  BT: { source: Position.Top, target: Position.Bottom },
  LR: { source: Position.Right, target: Position.Left },
  RL: { source: Position.Left, target: Position.Right },
};

let live: FlowGraph | null = null;

function toCanvasNodes(graph: FlowGraph, data: Pick<NodeData, "rename" | "open">) {
  const direction = graph.direction ?? "TB";
  return graph.nodes.map((node): FlowNodeType => {
    const size = sizeOf(node);
    return {
      id: node.id,
      type: "flow",
      position: { x: node.x ?? 0, y: node.y ?? 0 },
      width: size.width,
      height: size.height,
      data: { node, direction, ...data },
    };
  });
}

function toCanvasEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((edge, index) => ({
    id: edge.id ?? `e${index}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: edge.animated === true,
    markerEnd: edge.arrow === false ? undefined : { type: MarkerType.ArrowClosed },
    className: `flow-edge flow-accent-${edge.accent ?? "neutral"}${edge.dashed ? " flow-edge-dashed" : ""}`,
    data: { accent: edge.accent, dashed: edge.dashed, arrow: edge.arrow },
  }));
}

function fromCanvas(base: FlowGraph, nodes: FlowNodeType[], edges: Edge[]): FlowGraph {
  return {
    ...base,
    nodes: nodes.map((node) => ({
      ...node.data.node,
      x: node.position.x,
      y: node.position.y,
    })),
    edges: edges.map((edge): FlowEdge => {
      const stored = (edge.data ?? {}) as Partial<FlowEdge>;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === "string" ? edge.label : undefined,
        accent: stored.accent,
        dashed: stored.dashed,
        animated: edge.animated === true ? true : undefined,
        arrow: stored.arrow,
      };
    }),
  };
}

function FlowNodeView({ data, selected }: NodeProps<FlowNodeType>) {
  const { node, direction } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const handles = HANDLES[direction];

  useEffect(() => setDraft(node.label), [node.label]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== node.label) data.rename(node.id, draft.trim());
    else setDraft(node.label);
  };

  return (
    <div
      className={`flow-node flow-shape-${node.shape ?? "rounded"} flow-accent-${node.accent ?? "neutral"}${selected ? " is-selected" : ""}`}
      onDoubleClick={() => setEditing(true)}
    >
      {node.kind !== "input" && (
        <Handle type="target" position={handles.target} className="flow-handle" />
      )}
      <div className="flow-node-body">
        {editing ? (
          <input
            className="flow-node-input"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setDraft(node.label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="flow-node-label">{node.label}</span>
        )}
        {node.note && <span className="flow-node-note">{node.note}</span>}
      </div>
      {node.url && (
        <button
          type="button"
          className="flow-node-link"
          title={node.url}
          onClick={(event) => {
            event.stopPropagation();
            data.open(node.url as string);
          }}
        >
          ↗
        </button>
      )}
      {node.kind !== "output" && (
        <Handle type="source" position={handles.source} className="flow-handle" />
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { flow: FlowNodeView };

function useTrait<T>(model: AnyModel, name: string): T | undefined {
  const [value, setValue] = useState(() => model.get(name) as T | undefined);
  useEffect(() => {
    const update = () => setValue(model.get(name) as T | undefined);
    model.on(`change:${name}`, update);
    update();
    return () => model.off(`change:${name}`, update);
  }, [model, name]);
  return value;
}

function Widget({ model, experimental }: { model: AnyModel; experimental: Experimental }) {
  const data = useTrait<unknown>(model, "data");
  const config = useTrait<Record<string, unknown>>(model, "config");
  const theme = useTrait<ThemeTrait>(model, "theme");
  const capabilities = useTrait<string[]>(model, "capabilities");

  const editable = (capabilities ?? []).includes("core:config:write");
  const canNotify = (capabilities ?? []).includes("core:ui:notify");
  const canOpenLinks = (capabilities ?? []).includes("core:ui:open-link");

  const saved = typeof config?.graph === "string" ? config.graph : "";
  const source = useMemo(() => parseGraph(data), [data]);
  const base = useMemo(() => {
    const graph = parseGraph(saved) ?? source;
    return graph ? layout(graph) : null;
  }, [saved, source]);

  const [nodes, setNodes] = useState<FlowNodeType[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const flow = useRef<ReactFlowInstance<FlowNodeType, Edge> | null>(null);
  const applied = useRef("");
  const configRef = useRef<Record<string, unknown>>({});
  configRef.current = config ?? {};

  const notify = useCallback(
    (level: string, text: string) => {
      if (canNotify) experimental.invoke("core:ui:notify", { level, text }).catch(() => {});
    },
    [canNotify, experimental],
  );

  const rename = useCallback((id: string, label: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, node: { ...node.data.node, label } } } : node,
      ),
    );
  }, []);

  const open = useCallback(
    (url: string) => {
      if (canOpenLinks) experimental.invoke("core:ui:open-link", { url }).catch(() => {});
    },
    [canOpenLinks, experimental],
  );

  useEffect(() => {
    if (!base) {
      applied.current = "";
      live = null;
      setNodes([]);
      setEdges([]);
      return;
    }
    const text = serializeGraph(base);
    if (text === applied.current) return;
    applied.current = text;
    live = base;
    setNodes(toCanvasNodes(base, { rename, open }));
    setEdges(toCanvasEdges(base));
  }, [base, rename, open]);

  useEffect(() => {
    if (!base) return;
    const timer = setTimeout(() => {
      const graph = fromCanvas(base, nodes, edges);
      const text = serializeGraph(graph);
      if (text === applied.current) return;
      if (text.length > MAX_GRAPH_CHARS) {
        notify("warning", "The diagram is too large to save. Remove some nodes.");
        return;
      }
      applied.current = text;
      live = graph;
      if (!editable) return;
      model.set("config", { ...configRef.current, graph: text });
      model.save_changes();
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, edges, base, editable, model, notify]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeType>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${current.length}`,
            markerEnd: { type: MarkerType.ArrowClosed },
            className: "flow-edge flow-accent-neutral",
            data: {},
          },
          current,
        ),
      ),
    [],
  );

  const addNode = useCallback(
    (position: { x: number; y: number }, view?: Box) => {
      setNodes((current) => {
        const taken = new Set(current.map((node) => node.id));
        let index = current.length + 1;
        while (taken.has(`n${index}`)) index += 1;
        const node: FlowNode = { id: `n${index}`, label: "New step" };
        const size = sizeOf(node);
        const others = current.map((existing) => ({
          x: existing.position.x,
          y: existing.position.y,
          ...sizeOf(existing.data.node),
        }));
        return [
          ...current,
          {
            id: node.id,
            type: "flow",
            position: freeSpot(position, size, others, view),
            width: size.width,
            height: size.height,
            selected: true,
            data: { node, direction: base?.direction ?? "TB", rename, open },
          },
        ];
      });
    },
    [base, rename, open],
  );

  const revert = useCallback(() => {
    applied.current = "";
    model.set("config", { ...configRef.current, graph: "" });
    model.save_changes();
  }, [model]);

  useEffect(() => {
    const onMessage = (content?: unknown) => {
      const message = content as { kind?: string; name?: string; id?: string } | undefined;
      if (message?.kind !== "workspace-event" || message.name !== "action") return;
      if (message.id === "revert") revert();
      if (message.id === "add-node" && flow.current) {
        const at = (x: number, y: number) => flow.current!.screenToFlowPosition({ x, y });
        const corner = at(0, 0);
        const far = at(window.innerWidth, window.innerHeight);
        addNode(at(window.innerWidth / 2, window.innerHeight / 2), {
          x: corner.x,
          y: corner.y,
          width: far.x - corner.x,
          height: far.y - corner.y,
        });
      }
    };
    model.on("msg:custom", onMessage);
    return () => model.off("msg:custom", onMessage);
  }, [model, revert, addNode]);

  if (!base)
    return (
      <p className="flow-message" style={cssVariables(theme) as React.CSSProperties}>
        This widget did not get a diagram. A diagram is an object with a list of `nodes` and a list
        of `edges`.
      </p>
    );

  return (
    <div className="flow-stage" style={cssVariables(theme) as React.CSSProperties}>
      <ReactFlow
        onInit={(instance) => {
          flow.current = instance;
        }}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode={modeOf(theme)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        minZoom={0.15}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.8, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

const widget: WidgetModule = {
  initialize() {
    return {
      async exportOptions() {
        return live
          ? [{ id: "graph", label: "Diagram (JSON)", extension: "json", mime: "application/json" }]
          : [];
      },
      async exportData(id) {
        if (id !== "graph" || !live) return null;
        return JSON.stringify(live, null, 2);
      },
      async copilotContext() {
        if (!live) return null;
        return { title: live.title, direction: live.direction ?? "TB", nodes: live.nodes, edges: live.edges };
      },
    };
  },

  render({ model, el, signal, experimental }: RenderContext) {
    const root = createRoot(el);
    root.render(<Widget model={model} experimental={experimental} />);
    signal.addEventListener("abort", () => {
      live = null;
      root.unmount();
    });
  },
};

export default widget;
