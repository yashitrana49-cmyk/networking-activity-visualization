import { useMemo } from "react";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./NetworkGraph.css";

import type { NetworkEvent, BrowserEvent, DnsEvent } from "../types";

type NetworkGraphProps = {
  events: NetworkEvent[];
  browserEvents: BrowserEvent[];
  dnsEvents: DnsEvent[];
};

function NetworkGraph({ events, browserEvents, dnsEvents }: NetworkGraphProps) {
  // ============================================================
  // NODES
  // ============================================================

  const nodes = useMemo<Node[]>(() => {
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
            (domain) =>
              domain && domain !== "Unknown" && domain !== "localhost",
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

      ...browserPages.map((domain, index) => ({
        id: `page-${domain}`,

        position: {
          x: 0,
          y: index * 100,
        },

        data: {
          label: domain,
        },

        style: {
          background: "#f59e0b",
          color: "white",
          border: "none",
          width: 180,
        },
      })),

      // ========================================================
      // PROCESS NODES
      // ========================================================

      ...processes.map((name, index) => ({
        id: `process-${name}`,

        position: {
          x: 250,
          y: index * 100 + browserPages.length * 40,
        },

        data: {
          label: name,
        },

        style: {
          background: "#2563eb",
          color: "white",
          border: "none",
          width: 160,
        },
      })),

      // ========================================================
      // DOMAIN NODES
      // ========================================================

      ...allDomains.map((name, index) => ({
        id: `domain-${name}`,

        position: {
          x: 550,
          y: index * 100,
        },

        data: {
          label: name,
        },

        style: {
          background: "#7c3aed",
          color: "white",
          border: "none",
          width: 200,
        },
      })),

      // ========================================================
      // IP NODES
      // ========================================================

      ...ips.map((ip, index) => ({
        id: `ip-${ip}`,

        position: {
          x: 900,
          y: index * 100,
        },

        data: {
          label: ip,
        },

        style: {
          background: "#475569",
          color: "white",
          border: "none",
          width: 160,
        },
      })),
    ];
  }, [events, browserEvents, dnsEvents]);

  // ============================================================
  // EDGES
  // ============================================================

  const edges = useMemo<Edge[]>(() => {
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
          strokeDasharray: "5 5",
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
          strokeDasharray: "2 4",
        },
      });
    });

    return [...uniqueEdges.values()];
  }, [events, browserEvents, dnsEvents]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <section className="graph-section">
      <h2>Connection Map</h2>

      <div className="graph-container">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />

          <Controls />
        </ReactFlow>
      </div>
    </section>
  );
}

export default NetworkGraph;
