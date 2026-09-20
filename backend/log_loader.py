"""
Log-file loader: turn an uploaded network log into dashboard events.

Accepted formats:
- JSON  — a list of event objects (or a single object, or {"events": [...]})
- JSONL — one JSON object per line
- CSV   — first row must be a header
- Plain text — netstat-style lines; IPs, ports, protocols and
  states are extracted heuristically

Field names are flexible: timestamp/time/date, process/process_name/app,
domain/host, destination_ip/dest_ip/remote_ip/ip, protocol/proto,
port/dport, state/status, packets, bytes. Timestamps may be epoch
seconds/milliseconds or any ISO-ish string.
"""

import csv
import io
import json
import re
from datetime import datetime, timezone

from dns_monitor import find_domain_for_ip


MAX_LOG_EVENTS = 20000

# Heuristic caps per format so a hostile file cannot pin the server.
MAX_JSON_BYTES = 20 * 1024 * 1024
MAX_TEXT_LINES = 100000


# --------------------------------------------------
# FIELD ALIASES
# --------------------------------------------------

_FIELD_ALIASES = {
    "timestamp": ("timestamp", "time", "date", "datetime"),
    "process_name": ("process_name", "process", "app", "application", "pname"),
    "domain": ("domain", "host", "hostname", "site"),
    "destination_ip": ("destination_ip", "dest_ip", "dst_ip", "remote_ip", "ip", "destination", "target"),
    "protocol": ("protocol", "proto"),
    "port": ("port", "dport", "remote_port", "dest_port"),
    "local_port": ("local_port", "lport", "sport", "src_port"),
    "state": ("state", "status", "conn_state"),
    "packets": ("packets", "pkts", "packet_count"),
    "bytes": ("bytes", "size", "length"),
}


def _normalize_row(row):
    """Map any known alias in a dict row to the canonical field name."""
    normalized = {}

    for canonical, aliases in _FIELD_ALIASES.items():
        for alias in aliases:
            if alias in row and row[alias] not in (None, ""):
                normalized[canonical] = row[alias]
                break

    return normalized


# --------------------------------------------------
# VALUE PARSING
# --------------------------------------------------

_IPV4_RE = re.compile(
    r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b"
)

_PORT_RE = re.compile(r"[:.\s](\d{1,5})\b")

_PROTOCOL_WORDS = {
    "tcp": "TCP",
    "udp": "UDP",
    "icmp": "ICMP",
    "icmpv6": "ICMPv6",
    "igmp": "IGMP",
    "gre": "GRE",
    "esp": "ESP",
    "ah": "AH",
    "sctp": "SCTP",
    "raw": "RAW",
    "hopopt": "HOPOPT",
}


def parse_timestamp(value):
    """
    Accept epoch seconds/milliseconds or an ISO-ish string.
    Returns an ISO UTC string, or None if unparsable.
    """
    if value in (None, ""):
        return None

    # Epoch numbers (seconds or milliseconds).
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else float(value)
        try:
            return datetime.fromtimestamp(
                seconds, tz=timezone.utc
            ).isoformat(timespec="seconds")
        except (OverflowError, OSError, ValueError):
            return None

    text = str(value).strip()

    # Pure-digit strings are epoch too.
    if re.fullmatch(r"\d{10,13}", text):
        return parse_timestamp(int(text))

    try:
        parsed = datetime.fromisoformat(
            text.replace("Z", "+00:00")
        )
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc).isoformat(
        timespec="seconds"
    )


def parse_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        return 0

    return port if 0 <= port <= 65535 else 0


def parse_protocol(value):
    if value in (None, ""):
        return "OTHER"

    return _PROTOCOL_WORDS.get(
        str(value).strip().lower(),
        str(value).strip().upper(),
    )


def is_public_ipv4(text):
    """
    True for a plausible, non-private IPv4 destination.
    """
    match = _IPV4_RE.fullmatch(text)

    if not match:
        return False

    octets = [int(group) for group in match.groups()]

    if any(octet > 255 for octet in octets):
        return False

    first, second = octets[0], octets[1]

    if first in (0, 10, 127) or first >= 224:
        return False

    if first == 172 and 16 <= second <= 31:
        return False

    if first == 192 and second == 168:
        return False

    if first == 169 and second == 254:
        return False

    return True


def _fill_domain(event):
    """
    Prefer the log's own domain; otherwise correlate the IP
    against recent DNS observations.
    """
    if event.get("domain"):
        return event

    event["domain"] = find_domain_for_ip(
        event["destination_ip"]
    )

    return event


def build_event(row):
    """
    Normalize one raw dict into an event dict, or None if it
    has no usable destination.
    """
    normalized = _normalize_row(row)

    destination_ip = str(
        normalized.get("destination_ip", "")
    ).strip()

    if not is_public_ipv4(destination_ip):
        return None

    event = {
        "timestamp": parse_timestamp(
            normalized.get("timestamp")
        )
        or datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        ),
        "process_name": str(
            normalized.get("process_name") or "Unknown"
        ),
        "domain": str(normalized.get("domain") or "").strip(),
        "destination_ip": destination_ip,
        "protocol": parse_protocol(
            normalized.get("protocol")
        ),
        "port": parse_port(normalized.get("port")),
        "local_port": parse_port(
            normalized.get("local_port")
        ),
        "state": str(
            normalized.get("state") or "LOG"
        ).upper(),
    }

    packets = parse_port(normalized.get("packets"))

    if packets:
        event["packets"] = packets

    bytes_count = normalized.get("bytes")

    if isinstance(bytes_count, (int, float)) or (
        isinstance(bytes_count, str)
        and bytes_count.isdigit()
    ):
        event["bytes"] = int(bytes_count)

    return _fill_domain(event)


# --------------------------------------------------
# FORMAT PARSERS
# --------------------------------------------------

def _parse_json_rows(text):
    """
    Return a list of dict rows from JSON content. Eager (not a
    generator) so parse errors surface at the call site.
    Handles a top-level list, a single object, or {"events": [...]}
    """
    data = json.loads(text)

    if isinstance(data, dict):
        data = data.get("events", [data])

    if not isinstance(data, list):
        raise ValueError(
            "JSON log must be a list of event objects"
        )

    return [row for row in data if isinstance(row, dict)]


def _iter_jsonl_rows(text):
    for line in text.splitlines():
        line = line.strip()

        if not line:
            continue

        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue

        if isinstance(row, dict):
            yield row


def _iter_csv_rows(text):
    reader = csv.DictReader(io.StringIO(text))

    for row in reader:
        yield {
            key: value
            for key, value in row.items()
            if key and value
        }


def _guess_ip_port_chunks(line):
    """
    Split a plain-text line into 'ip[:port]' chunks so a
    netstat-style line yields both endpoints.
    """
    return re.findall(
        r"(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?",
        line,
    )


def _row_from_text_line(line):
    """
    Heuristic parse of one plain-text line (netstat-like).
    Returns a raw row dict, or None.
    """
    chunks = _guess_ip_port_chunks(line)

    protocol_match = re.search(
        r"\b(TCP|UDP|ICMP|ICMPv6|IGMP|GRE|ESP|SCTP|RAW)\b",
        line,
        re.IGNORECASE,
    )

    state_match = re.search(
        r"\b(ESTABLISHED|TIME_WAIT|CLOSE_WAIT|LISTENING|"
        r"SYN_SENT|FIN_WAIT1|FIN_WAIT2|CLOSED|LAST_ACK|"
        r"SYN_RECEIVED|BOUND|UDP)\b",
        line,
        re.IGNORECASE,
    )

    # A leading timestamp before the first IP.
    time_match = re.match(
        r"^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})",
        line,
    )

    remote_ip = ""
    remote_port = 0
    local_ip = ""
    local_port = 0

    for index, (ip, port) in enumerate(chunks):
        if is_public_ipv4(ip):
            remote_ip = ip
            remote_port = int(port) if port else 0
            # The chunk before the public IP is the local one.
            if index > 0:
                local_ip, local_port_str = chunks[index - 1]
                local_port = (
                    int(local_port_str)
                    if local_port_str
                    else 0
                )
            break

    if not remote_ip:
        return None

    row = {
        "destination_ip": remote_ip,
        "port": remote_port,
        "local_port": local_port,
        "protocol": protocol_match.group(1)
        if protocol_match
        else "OTHER",
        "state": state_match.group(1)
        if state_match
        else "LOG",
    }

    if time_match:
        row["timestamp"] = time_match.group(1)

    # Leading process name, e.g. "chrome.exe  1.2.3.4:443".
    name_match = re.match(
        r"^\s*([A-Za-z][A-Za-z0-9._-]{1,40}\.(?:exe|bin|py|sh))",
        line,
    )

    if name_match:
        row["process_name"] = name_match.group(1)
    else:
        # Otherwise look for a process token anywhere
        # ("... ESTABLISHED  Code.exe").
        anywhere = re.search(
            r"\b([A-Za-z][A-Za-z0-9._-]{1,40}\.exe)\b",
            line,
            re.IGNORECASE,
        )

        if anywhere:
            row["process_name"] = anywhere.group(1)

    return row


def _events_from_rows(rows):
    """Build normalized events from raw rows, capped."""
    events = []

    for row in rows:
        event = build_event(row)

        if event:
            events.append(event)

        if len(events) >= MAX_LOG_EVENTS:
            break

    return events


def _events_from_text(text):
    """Plain-text heuristic pass over the whole file."""
    events = []

    for line in text.splitlines()[:MAX_TEXT_LINES]:
        # JSON/JSONL lines are handled by the structured pass;
        # scraping IPs out of them would duplicate events.
        if line.lstrip().startswith(("{", "[")):
            continue

        row = _row_from_text_line(line)

        if row:
            event = build_event(row)

            if event:
                events.append(event)

            if len(events) >= MAX_LOG_EVENTS:
                break

    return events


def parse_log_text(text, filename):
    """
    Parse uploaded log text into normalized events. Format is
    chosen by extension, with JSON tried first for .txt/.log
    files (many tools export JSON with a log extension).
    """
    lower = filename.lower()

    try:
        if lower.endswith(".csv"):
            return _events_from_rows(_iter_csv_rows(text))

        if lower.endswith((".jsonl", ".ndjson")):
            return _events_from_rows(_iter_jsonl_rows(text))

        if lower.endswith(".json"):
            return _events_from_rows(_parse_json_rows(text))
    except (json.JSONDecodeError, ValueError):
        # A structured file that failed to parse yields no
        # events — an empty result, not a crash.
        return []

    # .txt / .log: try JSON shapes first (whole-file JSON,
    # then JSONL), then the plain-text heuristic pass. JSONL
    # and text results are MERGED so mixed logs (some lines
    # JSON, some netstat-style) keep every event.
    try:
        json_events = _events_from_rows(_parse_json_rows(text))
    except (json.JSONDecodeError, ValueError):
        json_events = None

    if json_events is not None:
        return json_events

    jsonl_events = _events_from_rows(_iter_jsonl_rows(text))
    text_events = _events_from_text(text)

    if not jsonl_events:
        return text_events

    if not text_events:
        return jsonl_events

    seen = set()
    merged = []

    for event in jsonl_events + text_events:
        identity = (
            event["timestamp"],
            event["destination_ip"],
            event["protocol"],
            event["port"],
            event["local_port"],
        )

        if identity in seen:
            continue

        seen.add(identity)
        merged.append(event)

    return merged[:MAX_LOG_EVENTS]


# --------------------------------------------------
# UPLOAD STATE
# --------------------------------------------------

_uploaded_events = []

_upload_info = {
    "loaded": False,
    "filename": "",
    "event_count": 0,
    "error": "",
}


def load_log_file(filename, content_bytes):
    """
    Store the events of an uploaded log. Replaces any
    previously loaded log.
    """
    global _uploaded_events

    try:
        text = content_bytes.decode(
            "utf-8",
            errors="replace",
        )
    except (UnicodeDecodeError, AttributeError):
        _set_upload_info(
            filename,
            0,
            "File could not be decoded as text.",
        )
        return 0, _upload_info["error"]

    try:
        events = parse_log_text(text, filename)
    except (ValueError, json.JSONDecodeError) as error:
        _set_upload_info(filename, 0, str(error))
        return 0, _upload_info["error"]

    _uploaded_events = events

    _set_upload_info(filename, len(events), "")

    return len(events), ""


def _set_upload_info(filename, count, error):
    _upload_info["loaded"] = count > 0
    _upload_info["filename"] = filename
    _upload_info["event_count"] = count
    _upload_info["error"] = error


def get_log_events():
    """
    Newest first, capped — the UI re-sorts as needed.
    """
    return list(_uploaded_events)


def get_upload_info():
    return dict(_upload_info)


def clear_log_events():
    global _uploaded_events

    _uploaded_events = []

    _set_upload_info("", 0, "")
