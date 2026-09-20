import os
import threading

from dns_monitor import (
    start_dns_monitor,
    get_dns_records,
    clear_dns_records,
)

from collector import (
    collect_live_connections,
    clear_event_history,
)
from packet_monitor import (
    clear_packet_flows,
    get_packet_flow_events,
    start_packet_monitor,
)
from log_loader import (
    clear_log_events,
    get_log_events,
    get_upload_info,
    load_log_file,
)
from fastapi.responses import JSONResponse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from ip_geolocation import geolocate_ip, geolocate_own_ip

from browser_collector import (
    add_browser_event,
    get_browser_events,
    clear_browser_events,
)
class BrowserEvent(BaseModel):
    timestamp: str = ""

    event_type: str = "unknown"

    tab_id: int = -1

    page_url: Optional[str] = None

    page_domain: Optional[str] = None

    domain: str = "Unknown"

    path: str = ""

    initiator: Optional[str] = None

    method: str = "UNKNOWN"

    resource_type: str = "other"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],
)


@app.get("/logs/status")
def logs_status():
    return get_upload_info()

@app.get("/events/log")
def get_events_from_log():
    return get_log_events()

@app.post("/logs/upload")
def upload_log(payload: dict):
    """
    Load a log file (JSON, JSONL, CSV or plain text) as the
    event source. The client sends {filename, content} with
    the file read as text.
    """
    filename = str(payload.get("filename") or "log.txt")

    content = payload.get("content")

    if not isinstance(content, str):
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "error": "Missing 'content' string.",
            },
        )

    count, error = load_log_file(
        filename,
        content.encode("utf-8", errors="replace"),
    )

    if error:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "error": error},
        )

    return {
        "status": "ok",
        "filename": filename,
        "event_count": count,
    }

@app.post("/logs/clear")
def clear_logs():
    clear_log_events()

    return {"status": "cleared"}

@app.post("/app/quit")
def quit_app():
    """
    Stop the backend (and the uvicorn reloader parent, if any).
    """
    threading.Timer(
        0.5,
        os._exit,
        args=(0,),
    ).start()

    return {"status": "quitting"}


dns_thread = threading.Thread(
    target=start_dns_monitor,
    daemon=True,
)
dns_thread.start()

packet_thread = threading.Thread(
    target=start_packet_monitor,
    daemon=True,
)
packet_thread.start()


@app.get("/events/live")
def get_live_events():
    # Socket-table events (TCP/UDP with process names) plus
    # packet-level flows for every other IP protocol the OS
    # table cannot see (ICMP, IGMP, GRE, ESP, ...).
    return collect_live_connections() + get_packet_flow_events()

@app.get("/dns")
def get_dns_history():
    return get_dns_records()

@app.post("/browser-events")
def receive_browser_event(event: BrowserEvent):

    event_data = event.model_dump()

    add_browser_event(event_data)

    return {
        "status": "ok"
    }

@app.get("/browser-events")
def browser_event_history():

    return get_browser_events()

@app.post("/clear-history")
def clear_history():
    clear_event_history()
    clear_browser_events()
    clear_dns_records()
    clear_packet_flows()
    clear_log_events()

    return {
        "status": "cleared"
    }

# Declared BEFORE /geo/{ip} so the fixed path wins —
# FastAPI matches routes in declaration order.
@app.get("/geo/self")
def get_own_location():
    return geolocate_own_ip()

@app.get("/geo/{ip}")
def get_ip_location(ip: str):
    return geolocate_ip(ip)