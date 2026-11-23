"""Malware scanning through a ClamAV daemon (clamd INSTREAM protocol)."""
from __future__ import annotations

import socket
import struct

from app.config import get_settings


class ScanError(Exception):
    pass


def scan_bytes(data: bytes) -> str:
    """Return 'clean', 'infected' or 'skipped'. Raises ScanError if the scanner fails."""
    s = get_settings()
    if not s.clamav_host:
        if s.require_malware_scan:
            raise ScanError("Malware scanner is required but not configured")
        return "skipped"
    try:
        with socket.create_connection((s.clamav_host, s.clamav_port), timeout=30) as sock:
            sock.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 64 * 1024):
                chunk = data[i:i + 64 * 1024]
                sock.sendall(struct.pack("!L", len(chunk)) + chunk)
            sock.sendall(struct.pack("!L", 0))
            reply = b""
            while not reply.endswith(b"\0"):
                part = sock.recv(4096)
                if not part:
                    break
                reply += part
    except OSError as exc:
        raise ScanError(f"scanner unreachable: {exc.__class__.__name__}") from exc
    text = reply.decode(errors="replace").strip("\0 \n")
    if text.endswith("OK"):
        return "clean"
    if "FOUND" in text:
        return "infected"
    raise ScanError("unexpected scanner reply")
