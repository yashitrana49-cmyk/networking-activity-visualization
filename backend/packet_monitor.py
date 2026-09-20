"""
Packet-level monitor for IP protocols the OS socket table does not show.

psutil's net_connections() only lists TCP sockets and UDP sockets the OS
tracks, so ICMP, IGMP, GRE, ESP, SCTP and connectionless UDP flows
(mDNS, QUIC-style traffic, ...) never appear in the dashboard. This
module sniffs raw IP headers with scapy, aggregates packets into FLOWS
(same protocol + remote host + local interface = one flow), and merges
those flows into the live event list so every captured protocol shows up.

Requires administrator/root to actually capture; without it the collector
starts but records nothing (the dashboard simply shows fewer events).
"""

from collections import OrderedDict
from datetime import datetime, timezone
from threading import Lock

from scapy.all import ICMP, IP, IPv6, conf, sniff

from dns_monitor import find_domain_for_ip


_packet_flows = OrderedDict()

_flows_lock = Lock()

MAX_FLOWS = 2000

MAX_FLOWS_SHOWN = 500


# --------------------------------------------------
# PROTOCOL NAMING
# --------------------------------------------------

IP_PROTOCOL_NAMES = {
    0: "HOPOPT",
    1: "ICMP",
    2: "IGMP",
    6: "TCP",
    17: "UDP",
    41: "IPv6",
    47: "GRE",
    50: "ESP",
    51: "AH",
    58: "ICMPv6",
    89: "OSPF",
    103: "PIM",
    112: "VRRP",
    132: "SCTP",
}


def get_packet_protocol_name(protocol_number):
    """
    IANA protocol number -> display name, with a numeric
    fallback so unknown protocols still show distinctly.
    """
    return IP_PROTOCOL_NAMES.get(
        protocol_number,
        f"IP-{protocol_number}",
    )


# --------------------------------------------------
# FLOW AGGREGATION
# --------------------------------------------------

def make_flow_key(protocol_number, local_ip, remote_ip):
    """
    Identity of a captured flow. Local interface and remote
    host are the key; ports are not visible in raw IP headers
    for non-TCP/UDP protocols.
    """
    return (protocol_number, local_ip, remote_ip)


def make_flow_event(key, flow):
    """
    Shape a stored flow like a NetworkEvent row. ICMP-style
    protocols have no remote port, so port 0 means "not
    applicable".
    """
    protocol_number, local_ip, remote_ip = key

    domain = find_domain_for_ip(remote_ip)

    return {
        # Time of the most recent packet in the flow, UTC
        # so packet events and socket events sort together.
        "timestamp": flow["last_seen"].isoformat(
            timespec="seconds"
        ),
        # Process attribution is not possible for raw IP
        # protocols (no socket table entry exists).
        "process_name": "System",
        "domain": domain,
        "destination_ip": remote_ip,
        "protocol": get_packet_protocol_name(
            protocol_number
        ),
        "port": 0,
        "state": "PACKETS",
        "packets": flow["packets"],
        "bytes": flow["bytes"],
    }


def record_packet_flow(protocol_number, local_ip, remote_ip, size):
    """
    Add (or update) one flow observation.
    """
    now = datetime.now(timezone.utc)

    with _flows_lock:

        key = make_flow_key(
            protocol_number,
            local_ip,
            remote_ip,
        )

        flow = _packet_flows.get(key)

        if flow:
            flow["last_seen"] = now
            flow["packets"] += 1
            flow["bytes"] += size
        else:
            _packet_flows[key] = {
                "first_seen": now,
                "last_seen": now,
                "packets": 1,
                "bytes": size,
            }

        # Drop the oldest flows once the cap is hit.
        while len(_packet_flows) > MAX_FLOWS:
            _packet_flows.popitem(last=False)


def get_packet_flow_events():
    """
    Flows sorted by recency, capped, shaped as events.
    """
    now = datetime.now(timezone.utc)

    with _flows_lock:
        flows = list(_packet_flows.items())

    def recency(item):
        key, flow = item
        return (
            now - flow["last_seen"]
        ).total_seconds()

    flows.sort(key=recency)

    return [
        make_flow_event(key, flow)
        for key, flow in flows[:MAX_FLOWS_SHOWN]
    ]


def clear_packet_flows():
    with _flows_lock:
        _packet_flows.clear()


# --------------------------------------------------
# SNIFFER
# --------------------------------------------------

def _local_ip_addresses():
    """
    Every address assigned to this machine's interfaces (IPv4
    and IPv6), so we can tell which side of a packet is ours.
    psutil sees the real adapter addresses, unlike a hostname
    lookup which misses the LAN IP on many setups.
    """
    import psutil

    addresses = set()

    try:
        for interface_addresses in psutil.net_if_addrs().values():
            for address in interface_addresses:
                if address.address:
                    addresses.add(address.address)
    except OSError:
        pass

    return addresses


def process_ip_packet(packet):
    """
    Sniffer callback: read the IP header and record a flow
    for every non-TCP/UDP protocol. TCP and UDP stay with
    the socket collector, which has process names.
    """
    if packet is None:
        return

    if IP in packet:
        ip_layer = packet[IP]
    elif IPv6 in packet:
        ip_layer = packet[IPv6]
    else:
        return

    protocol_number = int(
        ip_layer.nh if IPv6 in packet else ip_layer.proto
    )

    # These have their own richer source (psutil socket
    # table with process names and ports).
    if protocol_number in (6, 17):
        return

    source = ip_layer.src
    destination = ip_layer.dst

    local_addresses = _LOCAL_IP_CACHE

    source_is_local = source in local_addresses
    destination_is_local = destination in local_addresses

    if source_is_local and not destination_is_local:
        # Outbound packet.
        local_ip = source
        remote_ip = destination
    elif destination_is_local and not source_is_local:
        # Inbound packet.
        local_ip = destination
        remote_ip = source
    elif source_is_local and destination_is_local:
        # Loopback-style traffic.
        local_ip = source
        remote_ip = destination
    else:
        # Foreign-to-foreign traffic (promiscuous or bridge
        # capture): the local side cannot be known.
        local_ip = ""
        remote_ip = source

    record_packet_flow(
        protocol_number,
        local_ip,
        remote_ip,
        len(packet),
    )


# Module-level cache, filled once at startup.
_LOCAL_IP_CACHE: set = set()


def start_packet_monitor():
    """
    Entry point for the sniffer thread. Captures raw IP
    packets; requires admin on Windows / root on Linux to
    see anything.
    """
    global _LOCAL_IP_CACHE

    _LOCAL_IP_CACHE = _local_ip_addresses()

    print("Packet monitor started (non-TCP/UDP IP protocols)")

    try:
        sniff(
            iface=conf.iface,
            filter="ip or ip6",
            prn=process_ip_packet,
            store=False,
        )
    except Exception as error:
        # Without admin rights libpcap/npcap usually refuses
        # to open the adapter; degrade to a no-op so the API
        # keeps serving the socket-table events.
        print(f"Packet monitor disabled: {error}")
