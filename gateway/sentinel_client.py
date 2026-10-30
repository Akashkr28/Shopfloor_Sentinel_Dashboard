"""Shared bits for the gateway scripts: config loading and a buffered, one-way
POST to the Sentinel backend. Standard library only, so it runs on a bare
Raspberry Pi OS install.

The gateway is strictly observe -> report. Nothing here ever talks to a PLC,
HMI or any other plant device.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def load_config(path=None):
    path = path or os.environ.get("SENTINEL_GATEWAY_CONFIG") or os.path.join(HERE, "config.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["backendUrl"] = os.environ.get("SENTINEL_BACKEND_URL", cfg["backendUrl"]).rstrip("/")
    cfg["gatewayToken"] = os.environ.get("SENTINEL_GATEWAY_TOKEN", cfg["gatewayToken"])
    buf = cfg.get("bufferFile", "buffer.jsonl")
    cfg["bufferFile"] = buf if os.path.isabs(buf) else os.path.join(HERE, buf)
    return cfg


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _post(cfg, events):
    req = urllib.request.Request(
        cfg["backendUrl"] + "/events",
        data=json.dumps(events).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Gateway-Token": cfg["gatewayToken"]},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _read_buffer(cfg):
    if not os.path.exists(cfg["bufferFile"]):
        return []
    with open(cfg["bufferFile"], encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _write_buffer(cfg, events):
    if not events:
        if os.path.exists(cfg["bufferFile"]):
            os.remove(cfg["bufferFile"])
        return
    with open(cfg["bufferFile"], "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


def send_events(cfg, events):
    """POST events (plus anything buffered from earlier outages).

    If the backend is unreachable, events are appended to the local buffer file
    and retried on the next call, so a network drop never loses an alert.
    Returns the backend response, or None if buffered.
    """
    pending = _read_buffer(cfg) + list(events)
    if not pending:
        return None
    try:
        result = _post(cfg, pending)
        _write_buffer(cfg, [])
        return result
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code in (400, 401, 403):
            # A config problem, not an outage: don't buffer forever, tell the engineer.
            print(f"[gateway] backend rejected events ({e.code}): {body}", file=sys.stderr)
            _write_buffer(cfg, [])
            return None
        print(f"[gateway] backend error {e.code}, buffering {len(pending)} event(s)", file=sys.stderr)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        print(f"[gateway] backend unreachable ({e}), buffering {len(pending)} event(s)", file=sys.stderr)
    _write_buffer(cfg, pending)
    return None
