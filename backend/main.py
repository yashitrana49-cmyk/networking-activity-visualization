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

@app.get("/events")
def get_events():
    return [
        {
            "timestamp": "2026-09-19T09:00:00Z",
            "process_name": "chrome.exe",
            "domain": "google.com",
            "destination_ip": "142.250.195.14",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:02:10Z",
            "process_name": "chrome.exe",
            "domain": "youtube.com",
            "destination_ip": "142.250.183.46",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:05:23Z",
            "process_name": "Code.exe",
            "domain": "github.com",
            "destination_ip": "140.82.112.4",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:08:42Z",
            "process_name": "Discord.exe",
            "domain": "discord.com",
            "destination_ip": "162.159.136.232",
            "protocol": "UDP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:11:08Z",
            "process_name": "chrome.exe",
            "domain": "doubleclick.net",
            "destination_ip": "142.250.70.14",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:15:30Z",
            "process_name": "Spotify.exe",
            "domain": "spotify.com",
            "destination_ip": "104.199.65.124",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:20:15Z",
            "process_name": "OneDrive.exe",
            "domain": "onedrive.live.com",
            "destination_ip": "13.107.42.12",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:25:50Z",
            "process_name": "chrome.exe",
            "domain": "cloudflare.com",
            "destination_ip": "104.16.132.229",
            "protocol": "TCP",
            "port": 443,
        },
        {
            "timestamp": "2026-09-19T09:31:12Z",
            "process_name": "Teams.exe",
            "domain": "teams.microsoft.com",
            "destination_ip": "52.112.250.196",
            "protocol": "UDP",
            "port": 3478,
        },
        {
            "timestamp": "2026-09-19T09:36:45Z",
            "process_name": "chrome.exe",
            "domain": "example.com",
            "destination_ip": "93.184.216.34",
            "protocol": "TCP",
            "port": 443,
        },
    ]
dns_thread = threading.Thread(
    target=start_dns_monitor,
    daemon=True,
)
dns_thread.start()

@app.get("/events/live")
def get_live_events():
    return collect_live_connections()

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