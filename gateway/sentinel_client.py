"""Shared bits for the gateway scripts: config, a buffered one-way POST to the
Sentinel backend, a background sender, heartbeats and alert cooldowns.
Standard library only, so it runs on a bare Raspberry Pi OS install.

The gateway is strictly observe -> report. Nothing here ever talks to a PLC,
HMI or any other plant device.
"""
import json
import os
import queue
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "1.0.0"


def load_config(path=None):
    path = path or os.environ.get("SENTINEL_GATEWAY_CONFIG") or os.path.join(HERE, "config.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["backendUrl"] = os.environ.get("SENTINEL_BACKEND_URL", cfg["backendUrl"]).rstrip("/")
    cfg["gatewayToken"] = os.environ.get("SENTINEL_GATEWAY_TOKEN", cfg["gatewayToken"])
    cfg["gatewayId"] = os.environ.get("SENTINEL_GATEWAY_ID", cfg.get("gatewayId") or socket.gethostname())
    base = os.path.dirname(os.path.abspath(path))
    for key, default in (("bufferFile", "buffer.jsonl"), ("stateDir", "state")):
        val = cfg.get(key, default)
        cfg[key] = val if os.path.isabs(val) else os.path.join(base, val)
    return cfg


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _request(cfg, path, payload):
    req = urllib.request.Request(
        cfg["backendUrl"] + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Gateway-Token": cfg["gatewayToken"],
            "X-Gateway-Id": cfg["gatewayId"],
            "User-Agent": f"sentinel-gateway/{VERSION}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


_buffer_lock = threading.Lock()


def _read_buffer(cfg):
    if not os.path.exists(cfg["bufferFile"]):
        return []
    with open(cfg["bufferFile"], encoding="utf-8") as f:
        out = []
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass  # a half-written line from a power cut
        return out


def _write_buffer(cfg, events):
    if not events:
        if os.path.exists(cfg["bufferFile"]):
            os.remove(cfg["bufferFile"])
        return
    tmp = cfg["bufferFile"] + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for ev in events[-10000:]:  # cap the backlog so a long outage can't fill the SD card
            f.write(json.dumps(ev) + "\n")
    os.replace(tmp, cfg["bufferFile"])


def send_events(cfg, events):
    """POST events (plus anything buffered from earlier outages), 100 per request.

    If the backend is unreachable, events stay in the local buffer file and are
    retried on the next call, so a network drop never loses an alert.
    Returns the last backend response, or None if (partly) buffered.
    """
    with _buffer_lock:
        pending = _read_buffer(cfg) + list(events)
        result = None
        while pending:
            chunk = pending[:100]
            try:
                result = _post_chunk(cfg, chunk)
            except _Retry:
                _write_buffer(cfg, pending)
                return None
            pending = pending[100:]
        _write_buffer(cfg, [])
        return result


class _Retry(Exception):
    pass


def _post_chunk(cfg, chunk):
    try:
        return _request(cfg, "/events", chunk)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code in (400, 401, 403, 413):
            # A config/data problem, not an outage: don't buffer forever, tell the engineer.
            log(f"backend rejected {len(chunk)} event(s) ({e.code}): {body}")
            return None
        log(f"backend error {e.code}, buffering")
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        log(f"backend unreachable ({e}), buffering")
    raise _Retry()


def log(msg):
    print(f"[gateway {datetime.now().strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


class EventSender:
    """Background thread that batches events, so packet capture never blocks on HTTP."""

    def __init__(self, cfg, dry_run=False):
        self.cfg = cfg
        self.dry_run = dry_run
        self.q = queue.Queue()
        self.sent = 0
        self.thread = threading.Thread(target=self._run, name="sentinel-sender", daemon=True)
        self.thread.start()

    def emit(self, event_type, machine, details):
        ev = {"eventTypeKey": event_type, "machineIdentifier": machine, "timestamp": utc_now(), "details": details}
        print(f"[{ev['timestamp']}] {event_type:<20} {machine:<20} {json.dumps(details, default=str)}", flush=True)
        self.q.put(ev)
        return ev

    def _run(self):
        while True:
            batch = [self.q.get()]
            time.sleep(0.5)  # let a burst collect into one request
            while not self.q.empty() and len(batch) < 100:
                batch.append(self.q.get_nowait())
            if self.dry_run:
                self.sent += len(batch)
                continue
            if send_events(self.cfg, batch) is not None:
                self.sent += len(batch)

    def flush(self, timeout=10):
        end = time.time() + timeout
        while not self.q.empty() and time.time() < end:
            time.sleep(0.1)
        time.sleep(0.8)


def start_heartbeat(cfg, monitors, stats_fn=lambda: {}, every=60):
    """Tell the backend this gateway is alive; it alerts the owner if heartbeats stop."""

    def beat():
        while True:
            try:
                # Also flushes events buffered during an outage as soon as the backend is back.
                send_events(cfg, [])
                _request(cfg, "/gateway/heartbeat", {
                    "hostname": socket.gethostname(), "version": VERSION, "monitors": monitors, "stats": stats_fn(),
                })
            except Exception as e:  # noqa: BLE001 – never let the heartbeat thread die
                log(f"heartbeat failed: {e}")
            time.sleep(every)

    t = threading.Thread(target=beat, name="sentinel-heartbeat", daemon=True)
    t.start()
    return t


class Cooldown:
    """At most one alert per key per `seconds` – a brute-force run is one event, not hundreds."""

    def __init__(self, seconds):
        self.seconds = seconds
        self.last = {}

    def ready(self, key, now=None):
        now = time.time() if now is None else now
        if now - self.last.get(key, -1e18) < self.seconds:
            return False
        self.last[key] = now
        if len(self.last) > 50000:  # bound memory on a busy network
            cutoff = now - self.seconds
            self.last = {k: v for k, v in self.last.items() if v >= cutoff}
        return True
