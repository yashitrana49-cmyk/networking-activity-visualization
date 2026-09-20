"""
Tests for packet_monitor.py — protocol naming, flow aggregation
and event shaping. scapy sniffing itself is not exercised: only
the pure bookkeeping around it is.
"""

from datetime import datetime, timedelta, timezone

import pytest

import packet_monitor


def freeze_now(monkeypatch):
    """Pin datetime.now inside packet_monitor to a fixed UTC time."""
    fixed = datetime.now(timezone.utc)

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(
        packet_monitor,
        "datetime",
        FrozenDatetime,
    )

    return fixed


class TestProtocolNaming:
    @pytest.mark.parametrize(
        "protocol_number,expected",
        [
            (1, "ICMP"),
            (2, "IGMP"),
            (6, "TCP"),
            (17, "UDP"),
            (47, "GRE"),
            (50, "ESP"),
            (58, "ICMPv6"),
            (132, "SCTP"),
        ],
    )
    def test_known_protocol_numbers(self, protocol_number, expected):
        assert (
            packet_monitor.get_packet_protocol_name(protocol_number)
            == expected
        )

    def test_unknown_protocol_falls_back_to_number(self):
        assert (
            packet_monitor.get_packet_protocol_name(253)
            == "IP-253"
        )


class TestFlowAggregation:
    def test_first_packet_creates_flow(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(
            1, "192.168.1.5", "93.184.216.34", 84
        )

        events = packet_monitor.get_packet_flow_events()

        assert len(events) == 1
        assert events[0]["protocol"] == "ICMP"
        assert events[0]["destination_ip"] == "93.184.216.34"
        assert events[0]["packets"] == 1
        assert events[0]["bytes"] == 84

    def test_same_flow_accumulates(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)
        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)
        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)

        events = packet_monitor.get_packet_flow_events()

        assert len(events) == 1
        assert events[0]["packets"] == 3
        assert events[0]["bytes"] == 252

    def test_different_protocols_are_different_flows(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)
        packet_monitor.record_packet_flow(2, "192.168.1.5", "8.8.8.8", 40)

        events = packet_monitor.get_packet_flow_events()

        protocols = {event["protocol"] for event in events}

        assert protocols == {"ICMP", "IGMP"}

    def test_different_remote_ips_are_different_flows(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)
        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.4.4", 84)

        assert len(packet_monitor.get_packet_flow_events()) == 2

    def test_flows_sorted_most_recent_first(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        fixed = freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)

        # Simulate the second flow arriving later.
        later = fixed + timedelta(seconds=10)

        class LaterDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return later if tz else later.replace(tzinfo=None)

        monkeypatch.setattr(
            packet_monitor,
            "datetime",
            LaterDatetime,
        )

        packet_monitor.record_packet_flow(2, "192.168.1.5", "8.8.4.4", 40)

        events = packet_monitor.get_packet_flow_events()

        # The most recently active flow comes first.
        assert events[0]["destination_ip"] == "8.8.4.4"

    def test_flow_cap_drops_oldest(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        monkeypatch.setattr(
            packet_monitor,
            "MAX_FLOWS",
            2,
        )

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.1", 84)
        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.2", 84)
        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.3", 84)

        events = packet_monitor.get_packet_flow_events()

        destinations = {event["destination_ip"] for event in events}

        # Oldest flow (8.8.8.1) was evicted.
        assert destinations == {"8.8.8.2", "8.8.8.3"}

    def test_output_cap_limits_events(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        monkeypatch.setattr(
            packet_monitor,
            "MAX_FLOWS_SHOWN",
            3,
        )

        for last_octet in range(6):
            packet_monitor.record_packet_flow(
                1,
                "192.168.1.5",
                f"8.8.8.{last_octet}",
                84,
            )

        assert len(packet_monitor.get_packet_flow_events()) == 3


class TestFlowEventShape:
    def test_event_has_network_event_fields(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(47, "", "203.0.113.9", 100)

        event = packet_monitor.get_packet_flow_events()[0]

        assert event["process_name"] == "System"
        assert event["protocol"] == "GRE"
        assert event["port"] == 0
        assert event["state"] == "PACKETS"
        assert event["domain"] in ("Unknown",) or isinstance(
            event["domain"], str
        )

    def test_clear_removes_everything(self, monkeypatch):
        packet_monitor.clear_packet_flows()
        freeze_now(monkeypatch)

        packet_monitor.record_packet_flow(1, "192.168.1.5", "8.8.8.8", 84)

        packet_monitor.clear_packet_flows()

        assert packet_monitor.get_packet_flow_events() == []
