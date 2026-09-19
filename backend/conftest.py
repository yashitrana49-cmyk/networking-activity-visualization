"""
Pytest configuration.

Puts the backend directory on sys.path so the tests can import
the application modules (dns_monitor, collector, ip_geolocation)
regardless of where pytest is invoked from (backend/ or repo root).
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
