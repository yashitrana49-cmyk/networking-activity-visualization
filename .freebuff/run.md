# Run doc — Network Activity Visualizer (this worktree)

FastAPI backend (Python) + React/Vite frontend. The frontend needs the backend
API at `http://127.0.0.1:8000`; the preview points Vite at whatever port is free.

## 1. Reproduce the uncommitted artifacts

- **`frontend/.env`** — not committed. Copy the template and keep the default
  (the backend already runs on port 8000):
  ```
  cp frontend/.env.example frontend/.env      # VITE_API_URL="http://127.0.0.1:8000"
  ```
- **`frontend/node_modules`** — install dependencies:
  ```
  cd frontend && npm install
  ```
- **`backend/.venv`** — currently absent in this worktree. Only needed when
  starting the backend from scratch:
  ```
  cd backend
  python -m venv .venv
  .venv/Scripts/pip install -r requirements.txt
  ```

## 2. Backend

- **If port 8000 is already listening** (checked with
  `netstat -ano | grep -E ":(8000)" | grep -i listen`): an existing uvicorn
  instance is serving; just verify with `curl http://127.0.0.1:8000/events`
  (expect HTTP 200). Do not start a second one.
- **Otherwise**, start it detached (admin rights recommended so the DNS
  sniffer and packet monitor can capture; connections + geolocation work
  without it). Start WITHOUT `--reload`: the reload supervisor leaves
  zombie process trees behind on Windows when launched this way —
  restart manually after backend code changes instead:
  ```
  cd backend
  powershell -NoProfile -Command "(Start-Process -FilePath '.venv\Scripts\python.exe' -ArgumentList '-m','uvicorn','main:app','--port','8000' -WorkingDirectory '<abs path to backend>' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
  ```
  Verify: `curl http://127.0.0.1:8000/logs/status` → {"loaded":false,...}.
  Interactive docs at `/docs`. The dashboard's **Quit** button calls
  `POST /app/quit`, which stops this server.

## 3. Frontend (Vite dev server)

The default Vite port (5173) may already be taken by another process in this
checkout — check first with
`netstat -ano | grep -E ":(5173)" | grep -i listen`. If it is free, use 5173;
otherwise pass an explicit port.

Detached start (from `frontend/`), logging to the thread's log file:
```
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--port','5173','--strictPort' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
```
- stdout and stderr must go to **different** files (`<log>` and `<log>.err`).
- Confirm the pid survives: `powershell -NoProfile -Command "Get-Process -Id <pid>"`.
- Wait until the URL answers before registering the preview:
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/` → 200.

Then register the preview with the URL and the npm process id.
