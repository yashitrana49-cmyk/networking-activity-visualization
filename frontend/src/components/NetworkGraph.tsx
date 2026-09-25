import { useCallback, useEffect, useMemo, useState } from "react";

import dagre from "@dagrejs/dagre";

import {
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodesChange,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./NetworkGraph.css";

import type { NetworkEvent, BrowserEvent, DnsEvent } from "../types";

type NetworkGraphProps = {
  events: NetworkEvent[];
  browserEvents: BrowserEvent[];
  dnsEvents: DnsEvent[];
};

type NodeKind = "page" | "process" | "domain" | "ip";

type EntityNodeData = {
  label: string;
  kind: NodeKind;
};

type EntityNodeType = Node<EntityNodeData, "entity">;

const KIND_META: Record<NodeKind, { label: string; color: string }> = {
  page: { label: "Browser page", color: "#f59e0b" },
  process: { label: "Application", color: "#6366f1" },
  domain: { label: "Domain", color: "#8b5cf6" },
  ip: { label: "IP address", color: "#38bdf8" },
};

// Must match the .entity-node CSS dimensions so dagre and the
// rendered nodes agree on size.
const NODE_WIDTH = 185;
const NODE_HEIGHT = 44;

const EDGE_DEFAULT = "#4a5568";
const EDGE_BROWSER = "#f59e0b";
const EDGE_DNS = "#8b5cf6";

/**
 * Compute left-to-right layer positions with dagre.
 */
function layoutNodes(
  rawNodes: Omit<EntityNodeType, "position">[],
  rawEdges: Edge[],
): EntityNodeType[] {
  if (rawNodes.length === 0) {
    return [];
  }

  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 30,
    ranksep: 110,
    marginx: 12,
    marginy: 12,
  });

  rawNodes.forEach((node) => {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  rawEdges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  // dagre returns center coordinates; React Flow wants top-left.
  return rawNodes.map((node) => {
    const placed = graph.node(node.id);

    return {
      ...node,
      position: {
        x: placed.x - NODE_WIDTH / 2,
        y: placed.y - NODE_HEIGHT / 2,
      },
    };
  });
}

function EntityNode({ data }: NodeProps<EntityNodeType>) {
  return (
    <div className={`entity-node entity-node-${data.kind}`}>
      <Handle type="target" position={Position.Left} className="entity-handle" />

      <span className="entity-node-kind">{KIND_META[data.kind].label}</span>
      <span className="entity-node-label">{data.label}</span>

      <Handle type="source" position={Position.Right} className="entity-handle" />
    </div>
  );
}

// Module scope so the object identity is stable across renders.
const nodeTypes = {
  entity: EntityNode,
};

function NetworkGraph({ events, browserEvents, dnsEvents }: NetworkGraphProps) {
  return (
    <ReactFlowProvider>
      <NetworkGraphInner
        events={events}
        browserEvents={browserEvents}
        dnsEvents={dnsEvents}
      />
    </ReactFlowProvider>
  );
}

/**
 * Content signature of the graph inputs. Dagre positions only
 * depend on which nodes/edges exist (not on array identity), so
 * relayout must be gated on this — otherwise per-second polling
 * or row-flash timers would thrash the layout and move every
 * node while the camera stays put ("the graph disappeared").
 */
function layoutSignature(
  rawNodes: Omit<EntityNodeType, "position">[],
  rawEdges: Edge[],
): string {
  return `${rawNodes.map((node) => node.id).join("|")}#${rawEdges
    .map((edge) => edge.id)
    .join("|")}`;
}

function NetworkGraphInner({
  events,
  browserEvents,
  dnsEvents,
}: NetworkGraphProps) {
  const [layoutNonce, setLayoutNonce] = useState(0);
  // Nodes plus a version that increments only on content-driven
  // relayouts. The fit effect keys on the version, so panning,
  // zooming and node drags never yank the camera back.
  const [layout, setLayout] = useState<{
    nodes: EntityNodeType[];
    version: number;
  }>({ nodes: [], version: 0 });
  const { fitView } = useReactFlow();
  // ============================================================
  // NODES
  // ============================================================

  const rawNodes = useMemo<Omit<EntityNodeType, "position">[]>(() => {
    // ----------------------------------------------------------
    // DEVICE NETWORK DATA
    // ----------------------------------------------------------

    const processes = [
      ...new Set(
        events
          .map((event) => event.process_name)
          .filter((name) => name && name !== "Unknown"),
      ),
    ];

    const deviceDomains = [
      ...new Set(
        events
          .map((event) => event.domain)
          .filter((domain) => domain && domain !== "Unknown"),
      ),
    ];

    const deviceIps = [
      ...new Set(
        events
          .map((event) => event.destination_ip)
          .filter((ip) => ip && ip !== "Unknown"),
      ),
    ];

    const dnsIps = [
      ...new Set(
        dnsEvents
          .map((event) => event.ip)
          .filter((ip) => ip && ip !== "Unknown"),
      ),
    ];

    const ips = [...new Set([...deviceIps, ...dnsIps])];

    // ----------------------------------------------------------
    // BROWSER DATA
    // ----------------------------------------------------------

    const browserPages = [
      ...new Set(
        browserEvents
          .map((event) => event.page_domain)
          .filter(
            (domain): domain is string =>
              Boolean(domain) &&
              domain !== "Unknown" &&
              domain !== "localhost",
          ),
      ),
    ];

    const browserRequestDomains = [
      ...new Set(
        browserEvents
          .map((event) => event.domain)
          .filter(
            (domain) =>
              domain && domain !== "Unknown" && domain !== "localhost",
          ),
      ),
    ];

    // ----------------------------------------------------------
    // COMBINE DEVICE + BROWSER DOMAINS
    //
    // This is important.
    //
    // If the browser sees:
    //
    //     youtube.com
    //
    // and the device collector also sees:
    //
    //     youtube.com
    //
    // they must become ONE node.
    // ----------------------------------------------------------
    const dnsDomains = [
      ...new Set(
        dnsEvents
          .map((event) => event.domain)
          .filter(
            (domain) =>
              domain && domain !== "Unknown" && domain !== "localhost",
          ),
      ),
    ];

    const allDomains = [
      ...new Set([...deviceDomains, ...browserRequestDomains, ...dnsDomains]),
    ];

    // ----------------------------------------------------------
    // CREATE NODES
    // ----------------------------------------------------------

    return [
      // ========================================================
      // BROWSER PAGE NODES
      // ========================================================

      ...browserPages.map((domain) => ({
        id: `page-${domain}`,

        type: "entity" as const,

        data: {
          label: domain,
          kind: "page" as NodeKind,
        },
      })),

      // ========================================================
      // PROCESS NODES
      // ========================================================

      ...processes.map((name) => ({
        id: `process-${name}`,

        type: "entity" as const,

        data: {
          label: name,
          kind: "process" as NodeKind,
        },
      })),

      // ========================================================
      // DOMAIN NODES
      // ========================================================

      ...allDomains.map((name) => ({
        id: `domain-${name}`,

        type: "entity" as const,

        data: {
          label: name,
          kind: "domain" as NodeKind,
        },
      })),

      // ========================================================
      // IP NODES
      // ========================================================

      ...ips.map((ip) => ({
        id: `ip-${ip}`,

        type: "entity" as const,

        data: {
          label: ip,
          kind: "ip" as NodeKind,
        },
      })),
    ];
  }, [events, browserEvents, dnsEvents]);

  const rawEdges = useMemo<Edge[]>(
    () => buildEdges(events, browserEvents, dnsEvents),
    [events, browserEvents, dnsEvents],
  );

  // ------------------------------------------------------------
  // LAYOUT
  // Dagre computes positions. Adjusting state during render (the
  // pattern react.dev documents for "state that changes when props
  // change"): when the data or the layout nonce changes, relayout
  // immediately. Dragged positions persist via onNodesChange.
  // ------------------------------------------------------------

  const [prevLayoutInputs, setPrevLayoutInputs] = useState({
    signature: layoutSignature(rawNodes, rawEdges),
    layoutNonce,
  });

  const signature = layoutSignature(rawNodes, rawEdges);

  if (
    prevLayoutInputs.signature !== signature ||
    prevLayoutInputs.layoutNonce !== layoutNonce
  ) {
    setPrevLayoutInputs({ signature, layoutNonce });

    setLayout((current) => ({
      nodes: layoutNodes(rawNodes, rawEdges),
      version: current.version + 1,
    }));
  }

  const nodes = layout.nodes;

  const onNodesChange: OnNodesChange<EntityNodeType> = useCallback(
    (changes) => {
      setLayout((current) => ({
        ...current,
        nodes: applyNodeChanges(changes, current.nodes),
      }));
    },
    [],
  );

  // Re-fit after any content-driven relayout so a growing graph
  // (new connections, DNS entries, a large uploaded log) stays
  // fully in frame instead of flying off-screen. The version only
  // moves on relayout, never on pan/zoom/drag.
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      fitView({ padding: 0.15, duration: 300 });
    });
  }, [layout.version, fitView, nodes.length]);

  // ------------------------------------------------------------
  // HOVER HIGHLIGHTING
  // While a node is hovered, its direct neighbors stay lit and
  // everything else fades. null = no active hover.
  // ------------------------------------------------------------

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const connectedIds = useMemo(() => {
    if (!hoveredId) {
      return null;
    }

    const ids = new Set<string>([hoveredId]);

    rawEdges.forEach((edge) => {
      if (edge.source === hoveredId) {
        ids.add(edge.target);
      } else if (edge.target === hoveredId) {
        ids.add(edge.source);
      }
    });

    return ids;
  }, [hoveredId, rawEdges]);

  const styledNodes = useMemo<EntityNodeType[]>(
    () =>
      nodes.map((node) => ({
        ...node,

        className:
          connectedIds && !connectedIds.has(node.id)
            ? "node-dimmed"
            : undefined,
      })),
    [nodes, connectedIds],
  );

  const styledEdges = useMemo<Edge[]>(
    () =>
      rawEdges.map((edge) => ({
        ...edge,

        className:
          connectedIds &&
          edge.source !== hoveredId &&
          edge.target !== hoveredId
            ? "edge-dimmed"
            : undefined,
      })),
    [rawEdges, connectedIds, hoveredId],
  );

  const edges = styledEdges;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <section className="card graph-section">
      <div className="card-header">
        <h2 className="card-title">Connection Map</h2>
        <span className="card-meta">
          {nodes.length} nodes · {edges.length} links
        </span>
      </div>

      <div className="graph-container">
        <ReactFlow
          nodes={styledNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
          onNodeMouseLeave={() => setHoveredId(null)}
          fitView
          minZoom={0.15}
        >
          <Background gap={18} size={1.2} color="#1d2330" />

          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="graph-legend">
        {Object.entries(KIND_META).map(([kind, meta]) => (
          <span className="graph-legend-item" key={kind}>
            <span
              className="graph-legend-dot"
              style={{ background: meta.color }}
            />

            {meta.label}
          </span>
        ))}

        <button
          type="button"
          className="graph-legend-reset"
          // Bumping the nonce triggers a relayout, and the
          // effect above re-fits the view once it commits.
          onClick={() => setLayoutNonce((value) => value + 1)}
        >
          Reset layout
        </button>
      </div>
    </section>
  );
}

// ============================================================
// EDGES
// ============================================================

function buildEdges(
  events: NetworkEvent[],
  browserEvents: BrowserEvent[],
  dnsEvents: DnsEvent[],
): Edge[] {
  const uniqueEdges = new Map<string, Edge>();

    // ==========================================================
    // DEVICE CONNECTIONS
    //
    // Process → Domain
    // Domain → IP
    // ==========================================================

    events.forEach((event) => {
      if (!event.process_name || event.process_name === "Unknown") {
        return;
      }

      if (!event.domain || event.domain === "Unknown") {
        return;
      }

      if (!event.destination_ip || event.destination_ip === "Unknown") {
        return;
      }

      // ------------------------------------------------------
      // PROCESS → DOMAIN
      // ------------------------------------------------------

      const processToDomainId = `process-${event.process_name}-domain-${event.domain}`;

      uniqueEdges.set(processToDomainId, {
        id: processToDomainId,

        source: `process-${event.process_name}`,

        target: `domain-${event.domain}`,

        markerEnd: {
          type: MarkerType.ArrowClosed,
        },

        style: {
          stroke: EDGE_DEFAULT,
        },
      });

      // ------------------------------------------------------
      // DOMAIN → IP
      // ------------------------------------------------------

      const domainToIpId = `domain-${event.domain}-ip-${event.destination_ip}`;

      uniqueEdges.set(domainToIpId, {
        id: domainToIpId,

        source: `domain-${event.domain}`,

        target: `ip-${event.destination_ip}`,

        markerEnd: {
          type: MarkerType.ArrowClosed,
        },

        style: {
          stroke: EDGE_DEFAULT,
        },
      });
    });

    // ==========================================================
    // BROWSER CONNECTIONS
    //
    // Browser Page → Requested Domain
    // ==========================================================

    browserEvents.forEach((event) => {
      const pageDomain = event.page_domain;

      const requestDomain = event.domain;

      // Ignore unusable events.

      if (
        !pageDomain ||
        pageDomain === "Unknown" ||
        pageDomain === "localhost"
      ) {
        return;
      }

      if (
        !requestDomain ||
        requestDomain === "Unknown" ||
        requestDomain === "localhost"
      ) {
        return;
      }

      // ------------------------------------------------------
      // PAGE → REQUEST DOMAIN
      // ------------------------------------------------------

      const pageToDomainId = `page-${pageDomain}-domain-${requestDomain}`;

      uniqueEdges.set(pageToDomainId, {
        id: pageToDomainId,

        source: `page-${pageDomain}`,

        target: `domain-${requestDomain}`,

        markerEnd: {
          type: MarkerType.ArrowClosed,
        },

        style: {
          stroke: EDGE_BROWSER,
        },
      });
    });

    // ==========================================================
    // DNS CORRELATION
    //
    // Domain → IP
    //
    // Example:
    //
    // googlevideo.com
    //       |
    //       | DNS
    //       ↓
    // 142.250.x.x
    // ==========================================================

    dnsEvents.forEach((dnsEvent) => {
      const domain = dnsEvent.domain;

      const ip = dnsEvent.ip;

      if (!domain || domain === "Unknown") {
        return;
      }

      if (!ip || ip === "Unknown") {
        return;
      }

      const dnsEdgeId = `dns-${domain}-${ip}`;

      uniqueEdges.set(dnsEdgeId, {
        id: dnsEdgeId,

        source: `domain-${domain}`,

        target: `ip-${ip}`,

        markerEnd: {
          type: MarkerType.ArrowClosed,
        },

        style: {
          stroke: EDGE_DNS,
        },

        // React Flow animates the stroke dashes.
        animated: true,
      });
    });

  return [...uniqueEdges.values()];
}

export default NetworkGraph;
