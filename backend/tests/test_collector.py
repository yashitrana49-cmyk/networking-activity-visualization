"""
Tests for connection keying and protocol/state naming in collector.py.

Pure logic only: psutil is exercised through fakes, so no live
network table is read. A fake connection mimics the fields the
collector touches: laddr, raddr, pid, type, status.
"""

from collections import namedtuple

import socket

import pytest

import collector


Addr = namedtuple("Addr", ["ip", "port"])
Conn = namedtuple("Conn", ["laddr", "raddr", "pid", "type", "status"])


def make_connection(
    local_ip="192.168.1.5",
    local_port=51000,
    remote_ip="93.184.216.34",
    remote_port=443,
    pid=1234,
    conn_type=socket.SOCK_STREAM,
    status="ESTABLISHED",
    with_remote=True,
):
    return Conn(
        laddr=Addr(local_ip, local_port),
        raddr=Addr(remote_ip, remote_port) if with_remote else None,
        pid=pid,
        type=conn_type,
        status=status,
    )


class TestGetConnectionKey:
    def test_key_covers_all_identity_fields(self):
        connection = make_connection(
            local_ip="10.0.0.2",
            local_port=5001,
            remote_ip="8.8.8.8",
            remote_port=53,
            pid=42,
            conn_type=socket.SOCK_DGRAM,
        )

        key = collector.get_connection_key(connection)

        assert key == (
            42,            # pid
            "10.0.0.2",    # local ip
            5001,          # local port
            "8.8.8.8",     # remote ip
            53,            # remote port
            socket.SOCK_DGRAM,  # protocol
        )

    def test_different_ports_produce_different_keys(self):
        first = collector.get_connection_key(make_connection(local_port=5001))
        second = collector.get_connection_key(make_connection(local_port=5002))

        assert first != second

    def test_different_pids_produce_different_keys(self):
        first = collector.get_connection_key(make_connection(pid=1))
        second = collector.get_connection_key(make_connection(pid=2))

        assert first != second

    def test_different_remote_ips_produce_different_keys(self):
        first = collector.get_connection_key(make_connection(remote_ip="8.8.8.8"))
        second = collector.get_connection_key(make_connection(remote_ip="8.8.4.4"))

        assert first != second

    def test_tcp_and_udp_of_same_ports_differ(self):
        first = collector.get_connection_key(
            make_connection(conn_type=socket.SOCK_STREAM)
        )
        second = collector.get_connection_key(
            make_connection(conn_type=socket.SOCK_DGRAM)
        )

        assert first != second

    def test_missing_local_address_uses_placeholders(self):
        connection = Conn(
            laddr=None,
            raddr=Addr("8.8.8.8", 53),
            pid=7,
            type=socket.SOCK_DGRAM,
            status="",
        )

        key = collector.get_connection_key(connection)

        assert key == (7, "", 0, "8.8.8.8", 53, socket.SOCK_DGRAM)

    def test_same_connection_gives_equal_keys(self):
        connection = make_connection()

        assert collector.get_connection_key(connection) == collector.get_connection_key(
            make_connection()
        )


class TestProtocolAndStateNaming:
    @pytest.mark.parametrize(
        "sock_type,expected",
        [
            (socket.SOCK_STREAM, "TCP"),
            (socket.SOCK_DGRAM, "UDP"),
            (socket.SOCK_RAW, "RAW"),
            (9999, "OTHER"),
        ],
    )
    def test_protocol_names(self, sock_type, expected):
        assert collector.get_protocol_name(sock_type) == expected

    def test_udp_connection_state_is_udp(self):
        connection = make_connection(
            conn_type=socket.SOCK_DGRAM, status=""
        )

        assert collector.get_connection_state(connection) == "UDP"

    def test_tcp_connection_state_uses_status(self):
        connection = make_connection(status="ESTABLISHED")

        assert collector.get_connection_state(connection) == "ESTABLISHED"

    def test_empty_status_falls_back_to_unknown(self):
        connection = make_connection(status="")

        assert collector.get_connection_state(connection) == "UNKNOWN"


class TestProcessName:
    def test_zero_pid_means_system(self):
        assert collector.get_process_name(0) == "System"

    def test_none_pid_means_system(self):
        assert collector.get_process_name(None) == "System"

    def test_unavailable_pid_is_unknown(self, monkeypatch):
        class FakeProcess:
            def __init__(self, pid):
                raise collector.psutil.NoSuchProcess(pid)

        monkeypatch.setattr(collector.psutil, "Process", FakeProcess)

        assert collector.get_process_name(99999) == "Unknown"
