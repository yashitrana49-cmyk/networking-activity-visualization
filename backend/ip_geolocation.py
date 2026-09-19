import ipaddress
import time
from threading import Lock

import requests


# --------------------------------------------------
# GEOLOCATION CACHE
# --------------------------------------------------

_geo_cache = {}

_cache_lock = Lock()

# Keep cached locations for 24 hours.
CACHE_TTL_SECONDS = 60 * 60 * 24


# --------------------------------------------------
# LOCAL / PRIVATE IP CHECK
# --------------------------------------------------

def is_private_or_local_ip(ip: str) -> bool:
    """
    Returns True for addresses that should not be
    sent to an external geolocation service.

    Examples:
    127.0.0.1
    ::1
    192.168.x.x
    10.x.x.x
    172.16.x.x - 172.31.x.x
    link-local addresses
    """

    try:
        address = ipaddress.ip_address(ip)

        return (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_unspecified
        )

    except ValueError:
        return True


# --------------------------------------------------
# CACHE HELPERS
# --------------------------------------------------

def get_cached_location(ip: str):
    with _cache_lock:
        cached = _geo_cache.get(ip)

        if not cached:
            return None

        age = time.time() - cached["cached_at"]

        if age > CACHE_TTL_SECONDS:
            del _geo_cache[ip]
            return None

        return cached["data"]


def cache_location(ip: str, data: dict):
    with _cache_lock:
        _geo_cache[ip] = {
            "cached_at": time.time(),
            "data": data,
        }


def _unavailable_location(ip, reason):
    """
    Normalized result for lookups that produced no
    location (private IP, failed request, API error).
    """

    return {
        "ip": ip,
        "success": False,
        "reason": reason,
        "latitude": None,
        "longitude": None,
        "city": None,
        "region": None,
        "country": None,
        "country_code": None,
        "organization": None,
    }


# --------------------------------------------------
# IP GEOLOCATION
# --------------------------------------------------

def geolocate_ip(ip: str):
    """
    Convert a public IP address into an approximate
    geographic location.

    Results are cached so the same IP is not repeatedly
    looked up.
    """

    # ----------------------------------------------
    # Ignore private/local addresses
    # ----------------------------------------------

    if is_private_or_local_ip(ip):
        return _unavailable_location(
            ip,
            "private_or_local_ip",
        )


    # ----------------------------------------------
    # CACHE
    # ----------------------------------------------

    cached = get_cached_location(ip)

    if cached:
        return cached


    # ----------------------------------------------
    # EXTERNAL GEOLOCATION LOOKUP
    # ----------------------------------------------

    try:
        response = requests.get(
            f"https://ipwho.is/{ip}",
            timeout=5,
        )

        response.raise_for_status()

        result = response.json()

    except (
        requests.RequestException,
        ValueError,
    ):
        return _unavailable_location(
            ip,
            "lookup_failed",
        )


    # ----------------------------------------------
    # API FAILURE
    # ----------------------------------------------

    if not result.get("success", False):
        return _unavailable_location(
            ip,
            result.get(
                "message",
                "geolocation_failed",
            ),
        )


    # ----------------------------------------------
    # NORMALIZED RESULT
    # ----------------------------------------------

    connection = result.get(
        "connection",
        {}
    )

    data = {
        "ip": ip,

        "success": True,

        "reason": None,

        "latitude":
            result.get("latitude"),

        "longitude":
            result.get("longitude"),

        "city":
            result.get("city"),

        "region":
            result.get("region"),

        "country":
            result.get("country"),

        "country_code":
            result.get("country_code"),

        "organization":
            connection.get("org"),
    }


    # ----------------------------------------------
    # STORE IN CACHE
    # ----------------------------------------------

    cache_location(
        ip,
        data,
    )

    return data


# --------------------------------------------------
# DEVICE LOCATION
# --------------------------------------------------

def geolocate_own_ip():
    """
    Approximate the user's own location from the
    public IP the backend uses to reach the internet.

    The lookup itself resolves the public IP, so
    nothing about the local network setup needs to
    be known here.
    """

    cached = get_cached_location("self")

    if cached:
        return cached

    try:
        response = requests.get(
            "https://ipwho.is/",
            timeout=5,
        )

        response.raise_for_status()

        result = response.json()

    except (
        requests.RequestException,
        ValueError,
    ):
        return _unavailable_location(
            "self",
            "lookup_failed",
        )

    if not result.get("success", False):
        return _unavailable_location(
            "self",
            result.get(
                "message",
                "geolocation_failed",
            ),
        )

    connection = result.get(
        "connection",
        {}
    )

    data = {
        # The lookup service reports which public
        # IP the request came from.
        "ip": result.get("ip", "unknown"),

        "success": True,

        "reason": None,

        "latitude":
            result.get("latitude"),

        "longitude":
            result.get("longitude"),

        "city":
            result.get("city"),

        "region":
            result.get("region"),

        "country":
            result.get("country"),

        "country_code":
            result.get("country_code"),

        "organization":
            connection.get("org"),
    }

    cache_location(
        "self",
        data,
    )

    return data