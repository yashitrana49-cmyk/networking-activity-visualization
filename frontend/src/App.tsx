import NetworkGraph from "./components/NetworkGraph";
import { useEffect, useRef, useState } from "react";
import { getEvents, getLiveEvents, getBrowserEvents, getDnsEvents, clearHistory } from "./api";
import WorldMap from "./components/WorldMap";
import type { NetworkEvent, BrowserEvent, DnsEvent } from "./types";

function isLocalAddress(ip: string) {
  return ip.startsWith("127.") || ip === "::1";
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

  useEffect(() => {
    const loadEvents = dataSource === "sample" ? getEvents : getLiveEvents;

    const fetchEvents = () => {
      loadEvents()
        .then((loadedEvents) => {
          setEvents(loadedEvents);
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

      const isLocalConnection = isLocalAddress(address);

      const matchesLocalFilter = showLocalConnections || !isLocalConnection;

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
      <h1>Network Activity Visualizer</h1>
      <p>Recent connections detected on this device.</p>

      {error && <p>{error}</p>}

      <label>
        Data source:{" "}
        <select
          value={dataSource}
          onChange={(event) =>
            setDataSource(event.target.value as "sample" | "live")
          }
        >
          <option value="sample">Sample data</option>
          <option value="live">Live Windows connections</option>
        </select>
      </label>

      <label>
        Filter by application:{" "}
        <select
          value={selectedProcess}
          onChange={(event) => setSelectedProcess(event.target.value)}
        >
          {processes.map((process) => (
            <option key={process} value={process}>
              {process}
            </option>
          ))}
        </select>
      </label>

      {dataSource === "live" && (
        <button
          onClick={async () => {
            try {
              await clearHistory();

              setEvents([]);
              setBrowserEvents([]);
              setDnsEvents([]);

              setRefreshNumber((value) => value + 1);
            } catch (error) {
              console.error("Failed to clear history:", error);
            }
          }}
        >
          Refresh
        </button>
      )}

      <label>
        <input
          type="checkbox"
          checked={showLocalConnections}
          onChange={(event) => setShowLocalConnections(event.target.checked)}
        />{" "}
        Show local connections
      </label>

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
            {visibleEvents.map((event) => (
              <tr
                key={`${event.timestamp}-${event.process_name}-${event.destination_ip}-${event.port}`}
              >
                <td>{event.timestamp}</td>
                <td>{event.process_name}</td>
                <td>{event.domain}</td>
                <td>{event.destination_ip}</td>
                <td>{event.protocol}</td>
                <td>{event.port}</td>
                <td>{event.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="browser-activity">
        <h2>Browser Activity</h2>

        {browserEvents.length === 0 ? (
          <p className="browser-empty">No browser activity detected.</p>
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
    </main>
  );
}

export default App;
