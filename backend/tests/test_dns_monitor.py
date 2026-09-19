"""
Tests for the DNS record store and IP -> domain lookup logic.

These are pure-logic tests: no packet sniffing is started and no
network access happens. Records are seeded directly (with explicit
timestamps where timing matters) via the module's lock-protected list.
"""

from datetime import datetime, timedelta, timezone

import pytest

import dns_monitor


@pytest.fixture(autouse=True)
def clean_store():
    """Start every test with an empty DNS record store."""
    dns_monitor.clear_dns_records()
    yield
    dns_monitor.clear_dns_records()


def seed(domain, ip, age_seconds=0, record_type="A"):
    """Insert a record as if it had been observed age_seconds ago."""
    timestamp = (
        datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    ).isoformat(timespec="seconds")

    with dns_monitor._dns_lock:
        dns_monitor._dns_records.append(
            {
                "timestamp": timestamp,
                "domain": domain,
                "ip": ip,
                "type": record_type,
            }
        )


class TestAddDnsRecord:
    def test_adds_normalized_record(self):
        dns_monitor.add_dns_record("Example.COM.", "93.184.216.34", "A")

        records = dns_monitor.get_dns_records()

        assert len(records) == 1
        assert records[0]["domain"] == "example.com"  # lowercased, trailing dot removed
        assert records[0]["ip"] == "93.184.216.34"
        assert records[0]["type"] == "A"

    def test_timestamp_is_utc_aware(self):
        dns_monitor.add_dns_record("example.com", "93.184.216.34", "A")

        record = dns_monitor.get_dns_records()[0]
        parsed = datetime.fromisoformat(record["timestamp"])

        assert parsed.tzinfo is not None
        assert parsed.utcoffset() == timedelta(0)

    def test_rejects_empty_inputs(self):
        dns_monitor.add_dns_record("", "93.184.216.34", "A")
        dns_monitor.add_dns_record("example.com", "", "A")
        dns_monitor.add_dns_record(None, "93.184.216.34", "A")

        assert dns_monitor.get_dns_records() == []

    def test_deduplicates_recent_identical_records(self):
        for _ in range(5):
            dns_monitor.add_dns_record("example.com", "93.184.216.34", "A")

        assert len(dns_monitor.get_dns_records()) == 1

    def test_enforces_max_history(self):
        for index in range(dns_monitor.MAX_DNS_RECORDS + 100):
            dns_monitor.add_dns_record(f"domain-{index}.com", f"10.{index // 256}.{index % 256}.1", "A")

        assert len(dns_monitor.get_dns_records()) == dns_monitor.MAX_DNS_RECORDS


class TestFindDomainForIp:
    def test_returns_domain_for_known_ip(self):
        seed("example.com", "93.184.216.34", age_seconds=10)

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "example.com"

    def test_returns_unknown_for_missing_ip(self):
        assert dns_monitor.find_domain_for_ip("203.0.113.99") == "Unknown"

    def test_ignores_records_older_than_window(self):
        seed("old.example.com", "93.184.216.34", age_seconds=301)

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "Unknown"

    def test_includes_records_within_window(self):
        # 1s inside the 300s cutoff; testing the exact boundary
        # would be racy (sub-second execution delay pushes age past 300).
        seed("example.com", "93.184.216.34", age_seconds=299)

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "example.com"

    def test_most_recent_observation_wins(self):
        seed("old.example.com", "93.184.216.34", age_seconds=120)
        seed("new.example.com", "93.184.216.34", age_seconds=30)

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "new.example.com"

    def test_naive_timestamps_are_treated_as_utc(self):
        # Documented behavior: timestamps without timezone info are
        # interpreted as UTC. A naive-UTC 'just now' must count as recent.
        timestamp = (
            datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
        )

        with dns_monitor._dns_lock:
            dns_monitor._dns_records.append(
                {"timestamp": timestamp, "domain": "example.com", "ip": "93.184.216.34", "type": "A"}
            )

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "example.com"

    def test_malformed_timestamp_is_ignored(self):
        with dns_monitor._dns_lock:
            dns_monitor._dns_records.append(
                {"timestamp": "not-a-timestamp", "domain": "example.com", "ip": "93.184.216.34", "type": "A"}
            )

        assert dns_monitor.find_domain_for_ip("93.184.216.34") == "Unknown"


class TestGetRecentDnsRecords:
    def test_filters_by_age(self):
        seed("fresh.example.com", "93.184.216.34", age_seconds=60)
        seed("stale.example.com", "8.8.8.8", age_seconds=600)

        recent = dns_monitor.get_recent_dns_records(max_age_seconds=300)

        assert [record["domain"] for record in recent] == ["fresh.example.com"]

    def test_returns_snapshot_not_live_list(self):
        seed("example.com", "93.184.216.34")

        recent = dns_monitor.get_recent_dns_records()
        recent.clear()

        assert len(dns_monitor.get_recent_dns_records()) == 1
