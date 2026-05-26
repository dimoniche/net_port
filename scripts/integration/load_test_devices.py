#!/usr/bin/env python3
"""Load test: concurrent device registrations against the control server."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


def send_register(host: str, port: int, device_id: str, auth_token: str, timeout: float) -> dict:
    payload = json.dumps(
        {
            "action": "register",
            "device_id": device_id,
            "auth_token": auth_token,
            "version": "1.0",
        },
        separators=(",", ":"),
    )
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.sendall(payload.encode("utf-8"))
            sock.settimeout(timeout)
            chunks = []
            while True:
                try:
                    data = sock.recv(4096)
                except socket.timeout:
                    break
                if not data:
                    break
                chunks.append(data)
                try:
                    return json.loads(b"".join(chunks).decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    continue
            raw = b"".join(chunks).decode("utf-8", errors="replace")
            if raw.strip():
                return json.loads(raw)
            return {"status": "error", "message": "empty response"}
    except OSError as exc:
        return {"status": "error", "message": str(exc)}


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def psql_exec(sql: str, env: dict[str, str]) -> str:
    cmd = [
        "psql",
        "-h",
        env.get("DB_HOST", "127.0.0.1"),
        "-p",
        env.get("DB_PORT", "5432"),
        "-U",
        env.get("DB_USER", "admin"),
        "-d",
        env.get("DB_NAME", "net_port"),
        "-v",
        "ON_ERROR_STOP=1",
        "-Atqc",
        sql,
    ]
    result = subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "PGPASSWORD": env.get("DB_PASSWORD", "")},
    )
    return result.stdout.strip()


def prepare_devices(count: int, prefix: str, env: dict[str, str]) -> list[tuple[str, str]]:
    user_id = psql_exec("SELECT id FROM users ORDER BY id LIMIT 1;", env)
    if not user_id:
        raise RuntimeError("No users found in database")

    devices: list[tuple[str, str]] = []
    for index in range(count):
        device_id = f"{prefix}-{index:04d}"
        auth_token = f"{prefix}-token-{index:04d}"
        token_hash = sha256_hex(auth_token)
        psql_exec(
            f"""
            INSERT INTO devices (
              id, device_id, name, status, auth_token_hash,
              internal_address, internal_port, user_id, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), '{device_id}', 'Load Test {index}', 'connecting',
              '{token_hash}', '127.0.0.1', 22, {user_id}, NOW(), NOW()
            )
            ON CONFLICT (device_id) DO UPDATE SET
              status = 'connecting',
              auth_token_hash = EXCLUDED.auth_token_hash,
              assigned_port = NULL,
              updated_at = NOW();
            """,
            env,
        )
        devices.append((device_id, auth_token))
    return devices


def cleanup_devices(prefix: str, env: dict[str, str]) -> None:
    psql_exec(
        f"""
        DO $$
        DECLARE r RECORD;
        BEGIN
          FOR r IN SELECT device_id FROM devices WHERE device_id LIKE '{prefix}-%' LOOP
            PERFORM cleanup_device_sessions(r.device_id);
          END LOOP;
          FOR r IN
            SELECT id, preferred_port
            FROM devices
            WHERE device_id LIKE '{prefix}-%'
              AND preferred_port IS NOT NULL
          LOOP
            PERFORM release_device_port_reservation(r.id, r.preferred_port);
          END LOOP;
          DELETE FROM devices WHERE device_id LIKE '{prefix}-%';
        END $$;
        """,
        env,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Concurrent device registration load test")
    parser.add_argument("--host", default=os.environ.get("NET_PORT_CONTROL_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("NET_PORT_CONTROL_PORT", "8443")))
    parser.add_argument("--devices", type=int, default=int(os.environ.get("NET_PORT_LOAD_DEVICES", "20")))
    parser.add_argument("--workers", type=int, default=int(os.environ.get("NET_PORT_LOAD_WORKERS", "20")))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("NET_PORT_CONTROL_TIMEOUT", "10")))
    parser.add_argument("--prefix", default=os.environ.get("NET_PORT_LOAD_PREFIX", "load-test"))
    parser.add_argument("--skip-cleanup", action="store_true")
    args = parser.parse_args()

    env = {
        "DB_HOST": os.environ.get("DB_HOST", "127.0.0.1"),
        "DB_PORT": os.environ.get("DB_PORT", "5432"),
        "DB_USER": os.environ.get("DB_USER", "admin"),
        "DB_PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "DB_NAME": os.environ.get("DB_NAME", "net_port"),
    }

    if not env["DB_PASSWORD"]:
        print("Set DB_PASSWORD before running load test", file=sys.stderr)
        return 1

    devices = prepare_devices(args.devices, args.prefix, env)
    started = time.time()
    results: list[dict] = []

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [
                pool.submit(send_register, args.host, args.port, device_id, auth_token, args.timeout)
                for device_id, auth_token in devices
            ]
            for future in as_completed(futures):
                results.append(future.result())
    finally:
        if not args.skip_cleanup:
            cleanup_devices(args.prefix, env)

    elapsed = time.time() - started
    success = sum(1 for item in results if item.get("status") == "authenticated")
    auth_failed = sum(1 for item in results if item.get("message") == "Authentication failed")
    rate_limited = sum(1 for item in results if item.get("message") == "Rate limit exceeded")
    other_errors = len(results) - success - auth_failed - rate_limited

    print(f"devices={args.devices} workers={args.workers} elapsed={elapsed:.2f}s")
    print(f"authenticated={success} auth_failed={auth_failed} rate_limited={rate_limited} other_errors={other_errors}")

    if success == 0:
        print("Load test failed: no successful registrations", file=sys.stderr)
        return 1

    if success < max(1, args.devices // 2):
        print("Load test warning: less than 50% registrations succeeded", file=sys.stderr)
        return 1

    print("Load test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
