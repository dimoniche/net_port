#!/usr/bin/env python3
"""Minimal SSH-like TCP server for tunnel integration tests."""

import socket
import sys
import time

BANNER = b"SSH-2.0-net_port-integration-test\r\n"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: mock_ssh_server.py PORT", file=sys.stderr)
        return 2

    port = int(sys.argv[1])
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(32)
    sock.settimeout(1.0)

    print(f"mock-ssh listening on 127.0.0.1:{port}", flush=True)

    while True:
        try:
            conn, _addr = sock.accept()
        except socket.timeout:
            continue
        except KeyboardInterrupt:
            break

        with conn:
            conn.sendall(BANNER)
            conn.settimeout(2.0)
            try:
                payload = conn.recv(4096)
                if payload:
                    conn.sendall(payload)
            except OSError:
                pass

    sock.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
