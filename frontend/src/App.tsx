import NetworkGraph from "./components/NetworkGraph";
import { useEffect, useRef, useState } from "react";
import { getEvents, getLiveEvents, getBrowserEvents, getDnsEvents, clearHistory } from "./api";
import WorldMap from "./components/WorldMap";
import type { NetworkEvent, BrowserEvent, DnsEvent } from "./types";
import { isPrivateOrLocalIp } from "./utils/ip";

const PROTOCOL_BADGE: Record<string, string> = {
  TCP: "badge-blue",
  UDP: "badge-violet",
  RAW: "badge-amber",
};

/** Stable positive states get green, everything else gray. */
const STATE_BADGE: Record<string, string> = {
  ESTABLISHED: "badge-green",
  UDP: "badge-violet",
};

function protocolBadge(protocol: string) {
  return PROTOCOL_BADGE[protocol] ?? "badge-gray";
}

function stateBadge(state: string) {
  return STATE_BADGE[state] ?? "badge-gray";
}

/** "2026-09-20T18:03:07+00:00" -> "18:03:07". */
function formatTime(timestamp: string) {
  const parsed = new Date(timestamp);

  return Number.isNaN(parsed.getTime())
    ? timestamp
    : parsed.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
  });
}

function App() {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [browserEvents, setBrowserEvents] = useState<BrowserEvent[]>([]);
  const [dnsEvents, setDnsEvents] = useState<DnsEvent[]>([]);
  const [selectedProcess, setSelectedProcess] = useState("All");
  const [dataSource, setDataSource] = useState<"sample" | "live">("sample");
  const [error, setError] = useState("");
  const [showLocalConnections, setShowLocalConnections] = useState(true);
  const [refreshNumber, setRefreshNumber] = useState(0);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const knownEventKeys = useRef<Set<string>>(new Set());
  const [newEventKeys, setNewEventKeys] = useState<Set<string>>(new Set());

  /** Stable identity for a network event row. */
  const eventKey = (event: NetworkEvent) =>
    `${event.timestamp}-${event.process_name}-${event.destination_ip}-${event.port}`;

  useEffect(() => {
    const loadEvents = dataSource === "sample" ? getEvents : getLiveEvents;

    const fetchEvents = () => {
      loadEvents()
        .then((loadedEvents) => {
          const incomingKeys = new Set(loadedEvents.map(eventKey));

          // The very first load seeds the set without flashing
          // every row; afterwards, anything unseen is "new".
          const freshKeys = new Set<string>();

          if (knownEventKeys.current.size > 0) {
            incomingKeys.forEach((key) => {
              if (!knownEventKeys.current.has(key)) {
                freshKeys.add(key);
              }
            });
          }

          knownEventKeys.current = incomingKeys;

          setEvents(loadedEvents);
          setNewEventKeys(freshKeys);
          setError("");
        })
        .catch((err: Error) => setError(err.message));
    };

    fetchEvents();

    if (dataSource === "live") {
      const intervalId = setInterval(fetchEvents, 1000);

      return () => clearInterval(intervalId);
    }
  }, [dataSource, refreshNumber]);

  useEffect(() => {
    const loadBrowserEvents = () => {
      getBrowserEvents()
        .then((loadedEvents) => {
          setBrowserEvents(loadedEvents);
        })
        .catch((err: Error) => {
          console.error("Failed to load browser events:", err);
        });
    };

    loadBrowserEvents();

    if (dataSource === "live") {
      const intervalId = setInterval(loadBrowserEvents, 1000);

      return () => clearInterval(intervalId);
    }
  }, [dataSource]);

  useEffect(() => {
    const loadDnsEvents = () => {
      getDnsEvents()
        .then((loadedEvents) => {
          setDnsEvents(loadedEvents);
        })
        .catch((err: Error) => {
          console.error("Failed to load DNS events:", err);
        });
    };

    loadDnsEvents();

    if (dataSource === "live") {
      const intervalId = setInterval(loadDnsEvents, 1000);

      return () => clearInterval(intervalId);
    }
  }, [dataSource]);
  
  // Retire the flash class once the animation has played.
  useEffect(() => {
    if (newEventKeys.size === 0) {
      return;
    }

    const timerId = setTimeout(() => {
      setNewEventKeys(new Set());
    }, 1800);

    return () => clearTimeout(timerId);
  }, [newEventKeys]);

  const handleLogsScroll = () => {
    const container = logsContainerRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    // Only consider the user to be "away from bottom"
    // after a meaningful scroll.
    if (distanceFromBottom <= 120) {
      shouldAutoScroll.current = true;
    } else {
      shouldAutoScroll.current = false;
    }
  };

  const processes = [
    "All",
    ...new Set(events.map((event) => event.process_name)),
  ];

  const visibleEvents = [...events]
    .filter((event) => {
      const address = event.destination_ip.trim();

      const matchesProcess =
        selectedProcess === "All" || event.process_name === selectedProcess;

      const isPrivate = isPrivateOrLocalIp(address);

      const matchesLocalFilter = showLocalConnections || !isPrivate;

      return matchesProcess && matchesLocalFilter;
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    useEffect(() => {
      const container = logsContainerRef.current;

      if (!container || !shouldAutoScroll.current) {
        return;
      }

      const target = container.scrollHeight - container.clientHeight;

      const distance = target - container.scrollTop;

      if (distance <= 2) {
        container.scrollTop = target;
        return;
      }

      const duration = 150;
      const start = container.scrollTop;
      const startTime = performance.now();

      let animationFrame: number;

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const easedProgress = 1 - Math.pow(1 - progress, 3);

        container.scrollTop = start + (target - start) * easedProgress;

        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
        }
      };

      animationFrame = requestAnimationFrame(animate);

      return () => {
        cancelAnimationFrame(animationFrame);
      };
    }, [events]);

  return (
    <main>
      <header className="app-header">
        <div className="app-title">
          <h1>Network Activity Visualizer</h1>
          <p>Recent connections detected on this device.</p>
        </div>

        <span
          className={`status-pill ${
            dataSource === "live" ? "status-live" : "status-sample"
          }`}
          title={
            dataSource === "live"
              ? "Polling the backend every second"
              : "Showing bundled sample data"
          }
        >
          <span className="status-dot" />
          {dataSource === "live" ? "Live" : "Sample"}
        </span>
      </header>

      <div className="toolbar">
        <div className="field">
          <span className="field-label">Data source</span>
          <div className="segmented" role="group" aria-label="Data source">
            <button
              type="button"
              className={dataSource === "sample" ? "is-active" : ""}
              aria-pressed={dataSource === "sample"}
              onClick={() => setDataSource("sample")}
            >
              Sample
            </button>
            <button
              type="button"
              className={dataSource === "live" ? "is-active" : ""}
              aria-pressed={dataSource === "live"}
              onClick={() => setDataSource("live")}
            >
              Live
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="process-filter">
            Application
          </label>
          <select
            id="process-filter"
            className="select"
            value={selectedProcess}
            onChange={(event) => setSelectedProcess(event.target.value)}
          >
            {processes.map((process) => (
              <option key={process} value={process}>
                {process}
              </option>
            ))}
          </select>
        </div>

        {dataSource === "live" && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await clearHistory();

                setEvents([]);
                setBrowserEvents([]);
                setDnsEvents([]);

                setRefreshNumber((value) => value + 1);
              } catch (clearError) {
                console.error("Failed to clear history:", clearError);
              }
            }}
          >
            Clear history
          </button>
        )}

        <label className="switch">
          <input
            type="checkbox"
            checked={showLocalConnections}
            onChange={(event) => setShowLocalConnections(event.target.checked)}
          />
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
          <span className="switch-label">Show local connections</span>
        </label>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="stack">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Network Events</h2>
            <span className="card-meta">{visibleEvents.length} shown</span>
          </div>

          <div
            ref={logsContainerRef}
            className="logs-container"
            onScroll={handleLogsScroll}
          >
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Application</th>
              <th>Domain</th>
              <th>Destination IP</th>
              <th>Protocol</th>
              <th>Port</th>
              <th>State</th>
            </tr>
          </thead>

          <tbody>
            {visibleEvents.length === 0 && (
              <tr className="empty-row">
                <td colSpan={7}>No connections match the current filters.</td>
              </tr>
            )}

            {visibleEvents.map((event) => (
              <tr
                key={eventKey(event)}
                className={newEventKeys.has(eventKey(event)) ? "row-new" : ""}
              >
                <td className="cell-time">{formatTime(event.timestamp)}</td>
                <td className="cell-process">{event.process_name}</td>
                <td className="cell-dim">{event.domain}</td>
                <td className="cell-mono">{event.destination_ip}</td>
                <td>
                  <span className={`badge ${protocolBadge(event.protocol)}`}>
                    {event.protocol}
                  </span>
                </td>
                <td className="cell-mono">{event.port}</td>
                <td>
                  <span className={`badge ${stateBadge(event.state)}`}>
                    {event.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </section>

        <section className="card browser-activity">
          <div className="card-header">
            <h2 className="card-title">Browser Activity</h2>
            <span className="card-meta">{browserEvents.length} requests</span>
          </div>

          {browserEvents.length === 0 ? (
            <div className="empty-state">
              <p>No browser activity detected.</p>
              <span>Load the extension and browse to see requests here.</span>
            </div>
          ) : (
            <div className="browser-activity-list">
            {browserEvents
              .filter(
                (event) =>
                  event.page_domain &&
                  event.page_domain !== "Unknown" &&
                  event.page_domain !== "localhost",
              )
              .map((event, index) => (
                <div
                  className="browser-event"
                  key={`${event.timestamp}-${event.tab_id}-${event.domain}-${event.path}-${index}`}
                >
                  {/* PAGE */}

                  <div className="browser-event-header">
                    <strong>{event.page_domain}</strong>

                    <span>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* REQUEST DETAILS */}

                  <div className="browser-event-request">
                    <div>
                      <span className="browser-label">Request</span>

                      <strong>{event.domain}</strong>
                    </div>

                    <div>
                      <span className="browser-label">Path</span>

                      <span>{event.path || "/"}</span>
                    </div>

                    <div>
                      <span className="browser-label">Method</span>

                      <span>{event.method}</span>
                    </div>

                    <div>
                      <span className="browser-label">Type</span>

                      <span>{event.resource_type}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
        </section>

        <NetworkGraph
          events={visibleEvents}
          browserEvents={browserEvents}
          dnsEvents={dnsEvents}
        />

        <WorldMap events={visibleEvents} />
      </div>
    </main>
  );
}

export default App;
