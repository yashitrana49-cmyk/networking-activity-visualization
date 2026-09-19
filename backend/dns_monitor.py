from datetime import datetime, timezone
from threading import Lock

from scapy.all import DNS, DNSQR, DNSRR, sniff


_dns_records = []

_dns_lock = Lock()

MAX_DNS_RECORDS = 5000


def add_dns_record(domain, ip, record_type):
    if not domain or not ip:
        return

    domain = domain.rstrip(".").lower()

    record = {
        # UTC so DNS records, live network
        # events and browser events (which
        # already use UTC) line up.
        "timestamp": datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        ),
        "domain": domain,
        "ip": ip,
        "type": record_type,
    }

    with _dns_lock:

        # Avoid repeatedly storing the same
        # DNS response.
        for existing in _dns_records[-100:]:
            if (
                existing["domain"] == domain
                and existing["ip"] == ip
                and existing["type"] == record_type
            ):
                return

        _dns_records.append(record)

        if len(_dns_records) > MAX_DNS_RECORDS:
            del _dns_records[
                :-MAX_DNS_RECORDS
            ]


def process_dns_packet(packet):

    if not packet.haslayer(DNS):
        return

    dns = packet[DNS]

    if dns.ancount == 0:
        return

    for index in range(dns.ancount):

        answer = dns.an[index]

        if not answer.haslayer(DNSRR):
            continue

        record_type = answer.type

        domain = answer.rrname

        if isinstance(domain, bytes):
            domain = domain.decode(
                "utf-8",
                errors="ignore",
            )

        # IPv4
        if record_type == 1:

            ip = answer.rdata

            add_dns_record(
                domain,
                ip,
                "A",
            )

        # IPv6
        elif record_type == 28:

            ip = answer.rdata

            add_dns_record(
                domain,
                ip,
                "AAAA",
            )


def start_dns_monitor():

    print("DNS monitor started")

    sniff(
        filter="udp port 53 or tcp port 53",
        prn=process_dns_packet,
        store=False,
    )


def get_dns_records():

    with _dns_lock:
        return list(_dns_records)


def parse_record_time(timestamp):

    """
    Parse a stored ISO timestamp.

    Naive timestamps (no timezone) are
    assumed to be UTC.
    """

    try:
        record_time = datetime.fromisoformat(
            timestamp
        )
    except ValueError:
        return None

    if record_time.tzinfo is None:
        record_time = record_time.replace(
            tzinfo=timezone.utc
        )

    return record_time


def record_is_recent(record, now, max_age_seconds):

    record_time = parse_record_time(
        record["timestamp"]
    )

    if record_time is None:
        return False

    age = (now - record_time).total_seconds()

    return 0 <= age <= max_age_seconds


def find_domain_for_ip(ip, max_age_seconds=300):

    now = datetime.now(timezone.utc)

    with _dns_lock:
        records = list(_dns_records)

    matches = [
        record
        for record in records
        if record["ip"] == ip
        and record_is_recent(
            record,
            now,
            max_age_seconds,
        )
    ]

    if not matches:
        return "Unknown"

    # Most recent DNS observation wins.
    matches.sort(
        key=lambda record: record["timestamp"],
        reverse=True,
    )

    return matches[0]["domain"]

def get_recent_dns_records(max_age_seconds=300):
    """
    Return recent DNS observations.

    Only records observed within the last few minutes
    are considered for network correlation.
    """

    now = datetime.now(timezone.utc)

    with _dns_lock:
        records = list(_dns_records)

    return [
        record
        for record in records
        if record_is_recent(
            record,
            now,
            max_age_seconds,
        )
    ]

def clear_dns_records():
    with _dns_lock:
        _dns_records.clear()