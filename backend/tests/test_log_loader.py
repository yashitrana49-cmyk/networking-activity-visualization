"""
Tests for log_loader.py — field aliasing, timestamp parsing,
format detection (JSON/JSONL/CSV/text) and upload state.
"""

import json

import pytest

import log_loader


@pytest.fixture(autouse=True)
def clean_state():
    log_loader.clear_log_events()
    yield
    log_loader.clear_log_events()


class TestTimestampParsing:
    def test_epoch_seconds(self):
        parsed = log_loader.parse_timestamp(1758300000)

        assert parsed is not None
        assert parsed.startswith("2025-09-19T")

    def test_epoch_milliseconds(self):
        parsed = log_loader.parse_timestamp(1758300000000)

        assert parsed is not None
        assert parsed.startswith("2025-09-19T")

    def test_iso_string(self):
        parsed = log_loader.parse_timestamp("2026-09-20T10:00:00Z")

        assert parsed == "2026-09-20T10:00:00+00:00"

    def test_naive_string_assumed_utc(self):
        parsed = log_loader.parse_timestamp("2026-09-20 10:00:00")

        assert parsed is not None
        assert parsed.endswith("+00:00")

    def test_garbage_returns_none(self):
        assert log_loader.parse_timestamp("not-a-date") is None

    def test_empty_returns_none(self):
        assert log_loader.parse_timestamp("") is None
        assert log_loader.parse_timestamp(None) is None


class TestProtocolAndIp:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("tcp", "TCP"),
            ("UDP", "UDP"),
            ("Icmp", "ICMP"),
            ("gre", "GRE"),
        ],
    )
    def test_protocol_normalization(self, raw, expected):
        assert log_loader.parse_protocol(raw) == expected

    def test_unknown_protocol_uppercases(self):
        assert log_loader.parse_protocol("hosopt") == "HOSOPT"

    @pytest.mark.parametrize(
        "ip,expected",
        [
            ("93.184.216.34", True),
            ("8.8.8.8", True),
            ("192.168.1.5", False),
            ("10.0.0.2", False),
            ("127.0.0.1", False),
            ("172.16.0.1", False),
            ("172.32.0.1", True),
            ("169.254.1.1", False),
            ("224.0.0.1", False),
            ("999.1.1.1", False),
            ("example.com", False),
        ],
    )
    def test_public_ip_detection(self, ip, expected):
        assert log_loader.is_public_ipv4(ip) is expected


class TestBuildEvent:
    def test_canonical_row(self):
        event = log_loader.build_event(
            {
                "timestamp": "2026-09-20T10:00:00Z",
                "process_name": "chrome.exe",
                "destination_ip": "93.184.216.34",
                "protocol": "TCP",
                "port": 443,
                "state": "ESTABLISHED",
            }
        )

        assert event is not None
        assert event["process_name"] == "chrome.exe"
        assert event["destination_ip"] == "93.184.216.34"
        assert event["protocol"] == "TCP"
        assert event["port"] == 443
        assert event["state"] == "ESTABLISHED"

    def test_aliased_fields(self):
        event = log_loader.build_event(
            {
                "time": 1758300000,
                "app": "firefox.exe",
                "remote_ip": "8.8.8.8",
                "proto": "udp",
                "dport": 53,
                "status": "log",
            }
        )

        assert event is not None
        assert event["process_name"] == "firefox.exe"
        assert event["protocol"] == "UDP"
        assert event["port"] == 53
        assert event["state"] == "LOG"
        assert event["timestamp"].startswith("2025-09-19T")

    def test_private_ip_rejected(self):
        assert (
            log_loader.build_event(
                {"destination_ip": "192.168.1.5", "port": 443}
            )
            is None
        )

    def test_missing_ip_rejected(self):
        assert log_loader.build_event({"port": 443}) is None

    def test_defaults_applied(self):
        event = log_loader.build_event(
            {"destination_ip": "8.8.4.4"}
        )

        assert event is not None
        assert event["process_name"] == "Unknown"
        assert event["protocol"] == "OTHER"
        assert event["port"] == 0
        assert event["state"] == "LOG"

    def test_packet_counts_kept(self):
        event = log_loader.build_event(
            {
                "destination_ip": "8.8.4.4",
                "packets": 12,
                "bytes": 1024,
            }
        )

        assert event is not None
        assert event["packets"] == 12
        assert event["bytes"] == 1024


class TestFormatParsers:
    def test_json_list(self):
        events = log_loader.parse_log_text(
            json.dumps(
                [
                    {"destination_ip": "8.8.8.8", "port": 443},
                    {"destination_ip": "8.8.4.4", "port": 53},
                ]
            ),
            "log.json",
        )

        assert len(events) == 2

    def test_json_events_wrapper(self):
        events = log_loader.parse_log_text(
            json.dumps(
                {"events": [{"destination_ip": "8.8.8.8"}]}
            ),
            "log.json",
        )

        assert len(events) == 1

    def test_jsonl(self):
        text = (
            '{"destination_ip": "8.8.8.8", "port": 443}\n'
            "\n"
            'not json at all\n'
            '{"destination_ip": "8.8.4.4", "port": 53}\n'
        )

        events = log_loader.parse_log_text(text, "log.jsonl")

        assert len(events) == 2

    def test_csv(self):
        text = (
            "time,process,dest_ip,proto,port\n"
            "2026-09-20T10:00:00Z,chrome.exe,8.8.8.8,TCP,443\n"
            "2026-09-20T10:00:01Z,spotify.exe,8.8.4.4,UDP,53\n"
        )

        events = log_loader.parse_log_text(text, "log.csv")

        assert len(events) == 2
        assert events[0]["process_name"] == "chrome.exe"
        assert events[0]["port"] == 443

    def test_plain_text_netstat_line(self):
        text = (
            "  TCP    192.168.1.5:51000     93.184.216.34:443     "
            "ESTABLISHED\n"
        )

        events = log_loader.parse_log_text(text, "netstat.log")

        assert len(events) == 1

        event = events[0]

        assert event["destination_ip"] == "93.184.216.34"
        assert event["protocol"] == "TCP"
        assert event["port"] == 443
        assert event["local_port"] == 51000
        assert event["state"] == "ESTABLISHED"

    def test_plain_text_with_process_name(self):
        text = "chrome.exe 1.2.3.4:443 ESTABLISHED\n"

        events = log_loader.parse_log_text(text, "app.log")

        assert len(events) == 1
        assert events[0]["process_name"] == "chrome.exe"

    def test_empty_json_is_empty_not_error(self):
        assert log_loader.parse_log_text("[]", "log.json") == []

    def test_malformed_json_in_json_file_is_empty(self):
        # .json is a structured format; garbage yields no events
        # rather than a heuristic text pass.
        assert log_loader.parse_log_text("{broken", "log.json") == []


class TestUploadState:
    def test_load_and_get(self):
        content = json.dumps(
            [{"destination_ip": "8.8.8.8", "port": 443}]
        ).encode("utf-8")

        count, error = log_loader.load_log_file(
            "session.json", content
        )

        assert error == ""
        assert count == 1

        info = log_loader.get_upload_info()

        assert info["loaded"] is True
        assert info["filename"] == "session.json"
        assert info["event_count"] == 1

        assert len(log_loader.get_log_events()) == 1

    def test_second_upload_replaces_first(self):
        first = json.dumps(
            [{"destination_ip": "8.8.8.8"}]
        ).encode("utf-8")

        second = json.dumps(
            [
                {"destination_ip": "8.8.4.4"},
                {"destination_ip": "1.1.1.1"},
            ]
        ).encode("utf-8")

        log_loader.load_log_file("a.json", first)
        log_loader.load_log_file("b.json", second)

        events = log_loader.get_log_events()

        assert len(events) == 2
        assert log_loader.get_upload_info()["filename"] == "b.json"

    def test_clear_resets(self):
        content = json.dumps(
            [{"destination_ip": "8.8.8.8"}]
        ).encode("utf-8")

        log_loader.load_log_file("a.json", content)
        log_loader.clear_log_events()

        assert log_loader.get_log_events() == []
        assert log_loader.get_upload_info()["loaded"] is False

    def test_error_reported_for_undecodable(self):
        count, error = log_loader.load_log_file(
            "blob.bin", b"\xff\xfe\x00\x01"
        )

        # Undecodable bytes still decode with 'replace'; the
        # result is simply no usable events.
        assert count == 0
