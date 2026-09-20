from datetime import datetime, timezone
from threading import Lock

import socket
import psutil

from dns_monitor import (
    get_recent_dns_records,
)


_active_connections = set()

_event_history = []

# Protects _active_connections and _event_history.
# FastAPI runs sync endpoints in a threadpool,
# so several requests can mutate them at once.
_collector_lock = Lock()

MAX_HISTORY = 5000


def get_protocol_name(connection_type):

    if connection_type == socket.SOCK_STREAM:
        return "TCP"

    if connection_type == socket.SOCK_DGRAM:
        return "UDP"

    if connection_type == socket.SOCK_RAW:
        return "RAW"

    return "OTHER"


def get_connection_state(connection):

    if connection.type == socket.SOCK_DGRAM:
        return "UDP"

    return connection.status or "UNKNOWN"


def get_process_name(pid):

    if not pid:
        return "System"

    try:
        return psutil.Process(pid).name()

    except (
        psutil.NoSuchProcess,
        psutil.AccessDenied,
        psutil.ZombieProcess,
    ):
        return "Unknown"


def get_connection_key(connection):

    local = connection.laddr
    remote = connection.raddr

    return (
        connection.pid,

        local.ip if local else "",
        local.port if local else 0,

        remote.ip if remote else "",
        remote.port if remote else 0,

        connection.type,
    )


def find_domain_for_ip(ip):

    records = get_recent_dns_records()

    matches = [
        record
        for record in records
        if record["ip"] == ip
    ]

    if not matches:
        return "Unknown"

    # Most recent DNS observation.
    matches.sort(
        key=lambda record: record["timestamp"],
        reverse=True,
    )

    return matches[0]["domain"]


def update_existing_events():

    """
    Re-check events that previously had Unknown domains.

    This allows a DNS observation that arrives slightly
    after a network connection to update the event.
    """

    for event in _event_history:

        if event["domain"] != "Unknown":
            continue

        domain = find_domain_for_ip(
            event["destination_ip"]
        )

        if domain != "Unknown":
            event["domain"] = domain


def collect_live_connections():

    global _active_connections
    global _event_history

    try:

        connections = psutil.net_connections(
            kind="inet"
        )

    except (
        psutil.AccessDenied,
        OSError,
    ):

        with _collector_lock:
            return list(_event_history)

    current_connections = set()

    with _collector_lock:

        for connection in connections:

            if not connection.raddr:
                continue

            if connection.type not in (
                socket.SOCK_STREAM,
                socket.SOCK_DGRAM,
                socket.SOCK_RAW,
            ):
                continue

            key = get_connection_key(
                connection
            )

            current_connections.add(key)

            destination_ip = connection.raddr.ip

            # --------------------------------
            # DNS CORRELATION
            # --------------------------------

            domain = find_domain_for_ip(
                destination_ip
            )

            # --------------------------------
            # EXISTING CONNECTION
            # --------------------------------

            if key in _active_connections:

                # Find its historical event.
                #
                # If DNS information has now become
                # available, update the event.
                for event in reversed(_event_history):

                    if (
                        event["destination_ip"]
                        == destination_ip
                        and event["process_name"]
                        == get_process_name(
                            connection.pid
                        )
                    ):

                        if (
                            event["domain"]
                            == "Unknown"
                            and domain != "Unknown"
                        ):
                            event["domain"] = domain

                        break

                continue

            # --------------------------------
            # NEW CONNECTION
            # --------------------------------

            event = {
                # UTC so live events and browser
                # events sort consistently.
                "timestamp": datetime.now(timezone.utc).isoformat(
                    timespec="seconds"
                ),

                "process_name": get_process_name(
                    connection.pid
                ),

                "domain": domain,

                "destination_ip": destination_ip,

                "protocol": get_protocol_name(
                    connection.type
                ),

                "port": connection.raddr.port,

                # Local port: lets the UI tell apart parallel
                # connections to the same destination that
                # would otherwise share a row key.
                "local_port": connection.laddr.port if connection.laddr else 0,

                "state": get_connection_state(
                    connection
                ),
            }

            _event_history.append(event)

        # Current active sockets.
        _active_connections = current_connections

        # Limit memory usage.
        if len(_event_history) > MAX_HISTORY:

            _event_history = _event_history[
                -MAX_HISTORY:
            ]

        # Return a snapshot so callers can
        # serialize it without racing on the
        # live list.
        return list(_event_history)

def clear_event_history():
    global _active_connections
    global _event_history

    try:
        connections = psutil.net_connections(
            kind="inet"
        )
    except (
        psutil.AccessDenied,
        OSError,
    ):
        connections = []

    with _collector_lock:

        _active_connections = set()

        for connection in connections:
            if not connection.raddr:
                continue

            if connection.type not in (
                socket.SOCK_STREAM,
                socket.SOCK_DGRAM,
                socket.SOCK_RAW,
            ):
                continue

            _active_connections.add(
                get_connection_key(connection)
            )

        _event_history.clear()