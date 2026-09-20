# Network Activity Visualizer

See what your computer is doing on the network — live, or by studying an uploaded log. The dashboard combines:

- **Live OS connections** — which application is talking to which IP (via `psutil`)
- **DNS traffic** — which domains resolve to which IPs (via a `scapy` sniffer on port 53)
- **Packet-level flows** — every other IP protocol the socket table can't see (ICMP, IGMP, GRE, ESP, SCTP, ... via a `scapy` sniffer)
- **Browser activity** — page navigations and requests from a Chrome/Edge extension
- **Log study mode** — upload a network log (JSON, JSONL, CSV or plain netstat-style text) and browse it through the same table, filters and graph

The frontend correlates these into a connection table, a process → domain → IP graph, a browser activity feed, and a world map plotting the device and its connection destinations.

## Project structure

```
backend/            FastAPI server (Python)
  main.py           API endpoints
  collector.py      Live connection collector (psutil)
  dns_monitor.py    DNS sniffer (scapy)
  packet_monitor.py Packet-level flows for non-TCP/UDP IP protocols (scapy)
  browser_collector.py
  ip_geolocation.py IP → location lookup with caching (ipwho.is)

frontend/           React + TypeScript + Vite dashboard
  src/App.tsx       Event table + filters
  src/api.ts        API client (base URL from VITE_API_URL)
  src/components/   NetworkGraph (React Flow), WorldMap (Leaflet)

browser-extension/  Chrome MV3 extension that reports browser events
```

## Prerequisites

- Python 3.10+ (a `.venv` already exists in `backend/`)
- Node.js 18+
- Chrome or Edge
- **Administrator/root privileges for the backend** — sniffing DNS traffic and packet-level flows requires it. Without admin rights, connections and geolocation still work, but DNS correlation and the non-TCP/UDP protocol flows won't.

## Setup

### 1. Backend

```bash
cd backend

python -m venv .venv                # skip if .venv already exists
.venv\Scripts\activate              # Windows  (bash: source .venv/Scripts/activate)
pip install -r requirements.txt      # or requirements-dev.txt to also get pytest
```

Then start the API **from an elevated (Administrator) terminal** so the DNS sniffer can capture packets:

```bash
uvicorn main:app --reload --port 8000
```

The API is now at http://127.0.0.1:8000 (interactive docs at `/docs`).

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env              # adjust VITE_API_URL if the backend runs elsewhere
npm run dev
```

Open the printed URL (default http://localhost:5173). Use the **Data source** dropdown to switch between sample data and live connections.

### 3. Browser extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `browser-extension/` folder.
4. Browse normally — navigations and requests appear in the **Browser Activity** panel while the dashboard is in live mode.

The extension only talks to `http://127.0.0.1:8000` and ignores localhost/internal pages. Adjust `BACKEND_URL` in `browser-extension/background.js` if you change the backend port.

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/events/live` | Live connections + packet flows since startup |
| POST | `/logs/upload` | Load a log file (`{filename, content}`) as the event source |
| GET | `/events/log` | Events parsed from the uploaded log |
| GET | `/logs/status` | Upload state (filename, event count) |
| POST | `/logs/clear` | Remove the loaded log |
| GET | `/dns` | DNS observations (domain ↔ IP) |
| GET/POST | `/browser-events` | Browser events from the extension |
| POST | `/clear-history` | Clear all collected history |
| POST | `/app/quit` | Stop the backend |
| GET | `/geo/{ip}` | Geolocate an IP (cached 24 h, private IPs skipped) |
| GET | `/geo/self` | Geolocate this device via its own public IP (cached 24 h) |

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | `frontend/.env` | `http://127.0.0.1:8000` | Backend base URL used by the dashboard |

## Testing

The backend has a pytest suite covering its pure logic — no admin rights or network needed:

```bash
cd backend
.venv\Scripts\python -m pytest tests -v     # or: python -m pytest backend/tests from the repo root
```

- `tests/test_dns_monitor.py` — DNS record store: normalization, deduplication, history cap, IP → domain lookup with the 5-minute recency window, UTC handling
- `tests/test_ip_geolocation.py` — private/loopback/link-local/multicast classification, including 172.16/12 boundary cases
- `tests/test_collector.py` — connection identity keys, protocol/state naming, process-name resolution with psutil fakes
- `tests/test_packet_monitor.py` — IP-protocol naming, flow aggregation/eviction caps, event shaping for packet-level flows
- `tests/test_log_loader.py` — log parsing: field aliases, epoch/ISO timestamps, JSON/JSONL/CSV/text formats, upload state

## Privacy notes

- Everything is collected and stored **locally in memory** only — nothing leaves your machine except IP geolocation lookups to `ipwho.is` (public IPs only, cached, private addresses are never sent).
- The backend currently allows all CORS origins for local development. Don't expose it to a network without restricting `allow_origins` in `backend/main.py`.
