import type {
  NetworkEvent,
  BrowserEvent,
  DnsEvent,
  GeoLocation,
  UploadInfo,
} from "./types";

export type { UploadInfo };

// Single place where the backend location is configured.
// Set VITE_API_URL in .env (see .env.example); it must be
// set at build/dev-server start time, not runtime.
const API_BASE = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

export type UploadResult = {
  status: string;
  filename?: string;
  event_count?: number;
  error?: string;
};

async function getJson<T>(path: string, errorMessage: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export async function getLogEvents(): Promise<NetworkEvent[]> {
  return getJson<NetworkEvent[]>("/events/log", "Could not load log events.");
}

export async function getLogStatus(): Promise<UploadInfo> {
  return getJson<UploadInfo>("/logs/status", "Could not load log status.");
}

export async function uploadLogFile(
  filename: string,
  content: string,
): Promise<UploadResult> {
  const response = await fetch(`${API_BASE}/logs/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });

  const result = (await response.json()) as UploadResult;

  if (!response.ok) {
    throw new Error(result.error ?? `Upload failed (${response.status})`);
  }

  return result;
}

export async function clearLogs(): Promise<void> {
  const response = await fetch(`${API_BASE}/logs/clear`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to clear the loaded log (${response.status})`);
  }
}

export async function quitApp(): Promise<void> {
  const response = await fetch(`${API_BASE}/app/quit`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Quit request failed (${response.status})`);
  }
}

export async function getLiveEvents(): Promise<NetworkEvent[]> {
  return getJson<NetworkEvent[]>("/events/live", "Could not load live network events.");
}
export async function getBrowserEvents(): Promise<BrowserEvent[]> {
  return getJson<BrowserEvent[]>("/browser-events", "Browser events request failed");
}
export async function getDnsEvents(): Promise<DnsEvent[]> {
  return getJson<DnsEvent[]>("/dns", "DNS request failed");
}

export async function getIpLocation(ip: string): Promise<GeoLocation> {
  return getJson<GeoLocation>(
    `/geo/${encodeURIComponent(ip)}`,
    "Geo lookup failed",
  );
}

export async function getOwnLocation(): Promise<GeoLocation> {
  return getJson<GeoLocation>("/geo/self", "Own location lookup failed");
}

export async function clearHistory(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear-history`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to clear history (${response.status})`);
  }
}