import { useRef } from "react";
import { uploadLogFile } from "../api";

type NavBarProps = {
  dataSource: "log" | "live";
  onDataSourceChange: (source: "log" | "live") => void;
  logFileName: string;
  logEventCount: number;
  onLogLoaded: (filename: string, eventCount: number) => void;
  onLogError: (message: string) => void;
  onClearLog: () => void;
  onClearLiveHistory: () => void;
  onQuit: () => void;
};

function NavBar({
  dataSource,
  onDataSourceChange,
  logFileName,
  logEventCount,
  onLogLoaded,
  onLogError,
  onClearLog,
  onClearLiveHistory,
  onQuit,
}: NavBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChosen = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    // Reset so choosing the same file again re-fires onChange.
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const content = await file.text();

      const result = await uploadLogFile(file.name, content);

      onLogLoaded(
        result.filename ?? file.name,
        result.event_count ?? 0,
      );
    } catch (uploadError) {
      onLogError(
        uploadError instanceof Error
          ? uploadError.message
          : "Log upload failed.",
      );
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo" aria-hidden="true" />
        <span className="navbar-title">
          Network Activity Visualizer
        </span>
      </div>

      <div className="navbar-actions">
        <div
          className="segmented"
          role="group"
          aria-label="Data source"
        >
          <button
            type="button"
            className={dataSource === "log" ? "is-active" : ""}
            aria-pressed={dataSource === "log"}
            onClick={() => onDataSourceChange("log")}
          >
            Log
          </button>
          <button
            type="button"
            className={dataSource === "live" ? "is-active" : ""}
            aria-pressed={dataSource === "live"}
            onClick={() => onDataSourceChange("live")}
          >
            Live
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.jsonl,.ndjson,.csv,.txt,.log"
          className="navbar-file-input"
          onChange={handleFileChosen}
        />

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => fileInputRef.current?.click()}
          title="Upload a network log file (JSON, JSONL, CSV or plain text)"
        >
          Upload log
        </button>

        {dataSource === "log" && logFileName && (
          <>
            <span
              className="navbar-log-chip"
              title={`${logFileName} — ${logEventCount} events parsed`}
            >
              {logFileName} · {logEventCount} events
            </span>

            <button
              type="button"
              className="btn"
              onClick={onClearLog}
              title="Remove the loaded log"
            >
              Clear log
            </button>
          </>
        )}

        {dataSource === "live" && (
          <button
            type="button"
            className="btn"
            onClick={onClearLiveHistory}
            title="Clear collected live history"
          >
            Clear history
          </button>
        )}

        <button
          type="button"
          className="btn btn-quit"
          onClick={onQuit}
          title="Stop the backend and close the dashboard"
        >
          Quit
        </button>
      </div>
    </nav>
  );
}

export default NavBar;
