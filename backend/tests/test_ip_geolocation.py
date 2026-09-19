"""
Tests for private/local IP classification in ip_geolocation.

Pure logic only: no HTTP requests are made. The module imports
`requests` at top level, which is available from requirements.txt.
"""

import ipaddress

import pytest

from ip_geolocation import is_private_or_local_ip


class TestPrivateAndLocalIps:
    @pytest.mark.parametrize(
        "ip",
        [
            "127.0.0.1",       # loopback IPv4
            "127.255.0.9",     # whole 127/8 is loopback
            "::1",             # loopback IPv6
            "10.0.0.1",        # 10/8 private
            "10.255.255.255",
            "172.16.0.1",      # 172.16/12 private
            "172.31.255.255",  # top of the 172.16/12 range
            "192.168.1.1",     # 192.168/16 private
            "192.168.0.0",
            "169.254.1.1",     # link-local
            "fe80::1",         # link-local IPv6
            "224.0.0.1",       # multicast
            "ff02::1",         # multicast IPv6
            "0.0.0.0",         # unspecified
            "::",              # unspecified IPv6
            "203.0.113.7",     # documentation range (TEST-NET-3)
            "not-an-ip",       # unparseable strings are treated as unsafe
            "",
        ],
    )
    def test_classified_as_private_or_local(self, ip):
        assert is_private_or_local_ip(ip) is True

    def test_cgnat_follows_stdlib_classification(self):
        """100.64.0.0/10 (CGNAT) has shifted between stdlib versions
        (private on some, not on others). The module mirrors the
        stdlib, so assert agreement instead of a fixed answer."""
        expected = ipaddress.ip_address("100.64.0.1").is_private

        assert is_private_or_local_ip("100.64.0.1") is expected

    @pytest.mark.parametrize(
        "ip",
        [
            "8.8.8.8",          # public DNS
            "1.1.1.1",
            "93.184.216.34",    # public web server
            "172.32.0.1",       # just outside 172.16/12 -> public
            "172.15.255.255",   # just below the private range
            "192.169.0.1",      # just above 192.168/16
            "11.0.0.1",         # public (never actually assigned privately)
            "2606:4700:4700::1111",  # public IPv6
        ],
    )
    def test_classified_as_public(self, ip):
        assert is_private_or_local_ip(ip) is False


class TestBoundaryDocumentation:
    def test_172_boundary_is_documented_behavior(self):
        """172.15.x.x is public, 172.16.x.x is private — the module must
        use real range checks, not a string prefix test like startswith('172.')."""
        assert is_private_or_local_ip("172.15.255.255") is False
        assert is_private_or_local_ip("172.16.0.1") is True

    def test_mixed_sample_classification(self):
        """Explicit expectations for a mixed sample. Note the module is
        deliberately STRICTER than stdlib is_private alone: it also
        rejects multicast, loopback, link-local and unspecified
        addresses (e.g. 224.0.0.5 is not 'private' but must not be
        geolocated either)."""
        expectations = {
            "127.0.0.1": True,
            "8.8.8.8": False,
            "10.1.2.3": True,
            "172.16.9.9": True,
            "172.32.0.1": False,
            "192.168.100.100": True,
            "192.169.1.1": False,
            "::1": True,
            "2606:4700:4700::1111": False,
            "fe80::abcd": True,
            "224.0.0.5": True,   # multicast: not stdlib-private, still rejected
            "0.0.0.0": True,     # unspecified: same reasoning
        }

        for ip, expected in expectations.items():
            assert is_private_or_local_ip(ip) is expected, ip
