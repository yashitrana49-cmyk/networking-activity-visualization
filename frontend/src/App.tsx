import NetworkGraph from "./components/NetworkGraph";
import NavBar from "./components/NavBar";
import QuitOverlay from "./components/QuitOverlay";
import { useEffect, useRef, useState } from "react";
import {
  getLiveEvents,
  getLogEvents,
  getLogStatus,
  getBrowserEvents,
  getDnsEvents,
  clearHistory,
  clearLogs,
  quitApp,
} from "./api";
import WorldMap from "./components/WorldMap";
import type { NetworkEvent, BrowserEvent, DnsEvent, UploadInfo } from "./types";
import { isPrivateOrLocalIp } from "./utils/ip";

/**
 * Badge colors for the protocols we know about. Socket-table
 * events report TCP/UDP/RAW; packet-level flows can be any IP
 * protocol (ICMP, IGMP, GRE, ESP, SCTP, IP-<number>...); log
 * events may carry anything, including OTHER.
 */
const PROTOCOL_BADGE: Record<string, string> = {
  TCP: "badge-blue",
  UDP: "badge-violet",
  RAW: "badge-amber",
  ICMP: "badge-amber",
  ICMPv6: "badge-amber",
  IGMP: "badge-rose",
  GRE: "badge-rose",
  ESP: "badge-rose",
  AH: "badge-rose",
  OSPF: "badge-rose",
  PIM: "badge-rose",
  VRRP: "badge-rose",
  SCTP: "badge-rose",
};

/** Stable positive states get green, everything else gray. */
const STATE_BADGE: Record<string, string> = {
  ESTABLISHED: "badge-green",
  UDP: "badge-violet",
  PACKETS: "badge-violet",
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

const EMPTY_LOG_STATUS: UploadInfo = {
  loaded: false,
  filename: "",
  event_count: 0,
  error: "",
};

function App() {
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [browserEvents, setBrowserEvents] = useState<BrowserEvent[]>([]);
  const [dnsEvents, setDnsEvents] = useState<DnsEvent[]>([]);
  const [selectedProcess, setSelectedProcess] = useState("All");
  const [dataSource, setDataSource] = useState<"log" | "live">("log");
  const [logStatus, setLogStatus] = useState<UploadInfo>(EMPTY_LOG_STATUS);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quitting, setQuitting] = useState(false);
  const [showLocalConnections, setShowLocalConnections] = useState(true);
  const [refreshNumber, setRefreshNumber] = useState(0);
  const [logRefreshNumber, setLogRefreshNumber] = useState(0);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const knownEventKeys = useRef<Set<string>>(new Set());
  const [newEventKeys, setNewEventKeys] = useState<Set<string>>(new Set());

  /** Stable identity for a network event row. The local port
   * tells apart parallel connections to the same destination;
   * packet flows have no port, so packets/bytes count in. */
  const eventKey = (event: NetworkEvent) =>
    event.packets !== undefined
      ? `pkt-${event.protocol}-${event.destination_ip}`
      : `${event.timestamp}-${event.process_name}-${event.destination_ip}-${event.port}-${event.local_port ?? 0}`;

  useEffect(() => {
    const loadEvents = dataSource === "log" ? getLogEvents : getLiveEvents;

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
  }, [dataSource, refreshNumber, logRefreshNumber]);

  // Restore the upload state (e.g. after a page reload while
  // the backend still holds a parsed log).
  useEffect(() => {
    if (dataSource !== "log") {
      return;
    }

    getLogStatus()
      .then(setLogStatus)
      .catch(() => {
        /* status is cosmetic; ignore failures */
      });
  }, [dataSource, logRefreshNumber]);

  useEffect(() => {
    if (dataSource !== "live") {
      return;
    }

    const loadBrowserEvents = () => {
      getBrowserEvents()
        .then((loadedEvents) => {
          setBrowserEvents(loadedEvents);
        })
        .catch((err: Error) => {
          console.error("Failed to load browser events:", err);
        });
    };

    const loadDnsEvents = () => {
      getDnsEvents()
        .then((loadedEvents) => {
          setDnsEvents(loadedEvents);
        })
        .catch((err: Error) => {
          console.error("Failed to load DNS events:", err);
        });
    };

    loadBrowserEvents();
    loadDnsEvents();

    const intervalId = setInterval(() => {
      loadBrowserEvents();
      loadDnsEvents();
    }, 1000);

    return () => clearInterval(intervalId);
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

  const handleLogLoaded = (filename: string, eventCount: number) => {
    setLogStatus({
      loaded: eventCount > 0,
      filename,
      event_count: eventCount,
      error: "",
    });
    setNotice(
      eventCount > 0
        ? `Loaded ${filename} — ${eventCount} events parsed.`
        : `${filename} parsed, but no network events were found in it.`,
    );
    setError("");
    setSelectedProcess("All");
    setDataSource("log");
    setLogRefreshNumber((value) => value + 1);
  };

  const handleLogError = (message: string) => {
    setError(message);
    setNotice("");
  };

  const handleClearLog = async () => {
    try {
      await clearLogs();

      setLogStatus(EMPTY_LOG_STATUS);
      setEvents([]);
      setBrowserEvents([]);
      setDnsEvents([]);
      setSelectedProcess("All");
      setNotice("Loaded log removed.");
      setLogRefreshNumber((value) => value + 1);
    } catch (clearError) {
      console.error("Failed to clear the log:", clearError);
      setError("Failed to clear the loaded log.");
    }
  };

  const handleClearLiveHistory = async () => {
    try {
      await clearHistory();

      setEvents([]);
      setBrowserEvents([]);
      setDnsEvents([]);
      setNotice("Live history cleared.");
      setRefreshNumber((value) => value + 1);
    } catch (clearError) {
      console.error("Failed to clear history:", clearError);
      setError("Failed to clear live history.");
    }
  };

  const handleQuit = async () => {
    try {
      await quitApp();
    } catch {
      // The backend drops the connection mid-shutdown; that
      // is expected and still counts as quitting.
    }

    setQuitting(true);
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

  if (quitting) {
    return (
      <QuitOverlay
        message="The backend has been stopped. You can close this window now."
      />
    );
  }

  return (
    <main>
      <NavBar
        dataSource={dataSource}
        onDataSourceChange={(source) => {
          setDataSource(source);
          setNotice("");
          setError("");
        }}
        logFileName={logStatus.filename}
        logEventCount={logStatus.event_count}
        onLogLoaded={handleLogLoaded}
        onLogError={handleLogError}
        onClearLog={handleClearLog}
        onClearLiveHistory={handleClearLiveHistory}
        onQuit={handleQuit}
      />

      <header className="app-header">
        <div className="app-title">
          <h1>Network Activity Visualizer</h1>
          <p>
            {dataSource === "log"
              ? "Studying an uploaded network log."
              : "Recent connections detected on this device."}
          </p>
        </div>

        <span
          className={`status-pill ${
            dataSource === "live" ? "status-live" : "status-sample"
          }`}
          title={
            dataSource === "live"
              ? "Polling the backend every second"
              : logStatus.loaded
                ? `Loaded log: ${logStatus.filename}`
                : "No log loaded yet"
          }
        >
          <span className="status-dot" />
          {dataSource === "live" ? "Live" : "Log"}
        </span>
      </header>

      <div className="toolbar">
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
      {notice && !error && <p className="notice-banner">{notice}</p>}

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
              <th>Packets</th>
            </tr>
          </thead>

          <tbody>
            {visibleEvents.length === 0 && (
              <tr className="empty-row">
                <td colSpan={8}>
                  {dataSource === "log" && !logStatus.loaded
                    ? "Upload a network log file to study it here."
                    : "No connections match the current filters."}
                </td>
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
                <td className="cell-mono">{event.port || "—"}</td>
                <td>
                  <span className={`badge ${stateBadge(event.state)}`}>
                    {event.state}
                  </span>
                </td>
                <td className="cell-mono">
                  {event.packets !== undefined ? `${event.packets} pkt` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </section>

        {dataSource === "live" && (
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
        )}

        <NetworkGraph
          events={visibleEvents}
          browserEvents={dataSource === "live" ? browserEvents : []}
          dnsEvents={dataSource === "live" ? dnsEvents : []}
        />

        {dataSource === "live" && <WorldMap events={visibleEvents} />}
      </div>
    </main>
  );
}

export default App;
