#!/usr/bin/env python3
"""
Body Multi-Tracker · OSC bridge

Web pages are not allowed to send OSC (UDP) themselves, so the app sends its numbers to this
small program over a local WebSocket, and the bridge forwards them as OSC to any program:
TouchDesigner, Max/MSP, Pure Data, Processing, Unity, Max for Live, Isadora…

    app (Chrome) ──WebSocket ws://localhost:8766──▶ osc_bridge.py ──OSC/UDP──▶ 127.0.0.1:9000

Run it (Python 3, nothing to install):

    python3 osc_bridge.py                 # WebSocket on 8766
    python3 osc_bridge.py --ws-port 8766  # same, explicit

The OSC destination (IP + port) is chosen in the app's OSC OUT panel; the bridge follows it.
Only the app itself is allowed to connect: http://localhost:8765, http://127.0.0.1:8765 and
https://marlonbarrios.github.io. Add more with --allow-origin URL (repeatable), or --any-origin.

Concept and engineering by Marlon Barrios Solano. MIT License.
"""
import argparse, asyncio, base64, hashlib, json, socket, struct, sys, time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_ORIGINS = {
    "http://localhost:8765", "http://127.0.0.1:8765",
    "https://marlonbarrios.github.io",
}

# ---------- OSC encoding ----------
def _pad(b: bytes) -> bytes:
    return b + b"\0" * (4 - len(b) % 4)

def osc_message(address: str, types: str, args) -> bytes:
    out = _pad(address.encode()) + _pad(("," + types).encode())
    for t, a in zip(types, args):
        if t == "f":
            out += struct.pack(">f", float(a))
        elif t == "i":
            out += struct.pack(">i", int(a))
        elif t == "s":
            out += _pad(str(a).encode())
    return out

# ---------- bridge state ----------
class Bridge:
    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.host, self.port = "127.0.0.1", 9000
        self.count = 0
        self.rate = 0
        self.last = ""
        self.clients = 0

    def configure(self, host, port):
        try:
            port = int(port)
            socket.getaddrinfo(host, port)  # validates the host name / IP
        except Exception as e:
            return f"bad destination {host}:{port} ({e})"
        if (host, port) != (self.host, self.port):
            self.host, self.port = host, port
            print(f"  OSC destination → {host}:{port}", flush=True)
        return None

    def send(self, address, types, args):
        try:
            self.sock.sendto(osc_message(address, types, args), (self.host, self.port))
            self.count += 1
            self.last = address + " " + " ".join(
                f"{a:.3f}" if isinstance(a, float) else str(a) for a in args)
        except OSError as e:
            self.last = f"send error: {e}"

bridge = Bridge()

# ---------- minimal WebSocket server (RFC 6455, text frames) ----------
async def read_frame(reader):
    h = await reader.readexactly(2)
    opcode = h[0] & 0x0F
    masked = h[1] & 0x80
    n = h[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", await reader.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b"\0\0\0\0"
    data = bytearray(await reader.readexactly(n))
    for i in range(n):
        data[i] ^= mask[i % 4]
    return opcode, bytes(data)

def frame(opcode: int, payload: bytes) -> bytes:
    n = len(payload)
    if n < 126:
        head = struct.pack(">BB", 0x80 | opcode, n)
    elif n < 65536:
        head = struct.pack(">BBH", 0x80 | opcode, 126, n)
    else:
        head = struct.pack(">BBQ", 0x80 | opcode, 127, n)
    return head + payload

async def handle(reader, writer, origins, any_origin):
    peer = writer.get_extra_info("peername")
    try:
        request = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
    except Exception:
        writer.close(); return
    headers = {}
    for line in request.split("\r\n")[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    origin = headers.get("origin", "")
    key = headers.get("sec-websocket-key")
    if not key or "websocket" not in headers.get("upgrade", "").lower():
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\n"
                     b"This is the Body Multi-Tracker OSC bridge. Open the app and turn on OSC OUT.\n")
        await writer.drain(); writer.close(); return
    if not any_origin and origin not in origins:
        print(f"  refused a connection from {origin or 'unknown origin'} (not the app)", flush=True)
        writer.write(b"HTTP/1.1 403 Forbidden\r\n\r\n"); await writer.drain(); writer.close(); return

    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
    await writer.drain()
    bridge.clients += 1
    print(f"  app connected ({origin})", flush=True)

    async def status_loop():
        while True:
            msg = {"type": "status", "host": bridge.host, "port": bridge.port, "rate": bridge.rate}
            writer.write(frame(1, json.dumps(msg).encode()))
            await writer.drain()
            await asyncio.sleep(1)
    status_task = asyncio.create_task(status_loop())

    try:
        while True:
            opcode, data = await read_frame(reader)
            if opcode == 8:  # close
                break
            if opcode == 9:  # ping
                writer.write(frame(10, data)); await writer.drain(); continue
            if opcode != 1:
                continue
            try:
                msg = json.loads(data)
            except ValueError:
                continue
            if msg.get("type") == "config":
                err = bridge.configure(str(msg.get("host", "127.0.0.1")), msg.get("port", 9000))
                if err:
                    writer.write(frame(1, json.dumps({"type": "error", "error": err}).encode()))
                    await writer.drain()
            elif msg.get("type") == "batch":
                for item in msg.get("m", []):
                    try:
                        address, types, args = item
                        if isinstance(address, str) and address.startswith("/") and len(types) == len(args):
                            bridge.send(address, types, args)
                    except (ValueError, TypeError):
                        pass
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        status_task.cancel()
        bridge.clients -= 1
        print(f"  app disconnected", flush=True)
        writer.close()

async def report():
    while True:
        await asyncio.sleep(1)
        bridge.rate, bridge.count = bridge.count, 0
        if bridge.clients and bridge.rate:
            line = f"  → {bridge.host}:{bridge.port}  {bridge.rate:5d} msg/s   last: {bridge.last}"
            print(line[:120].ljust(120), end="\r", flush=True)

async def main():
    ap = argparse.ArgumentParser(description="Body Multi-Tracker OSC bridge")
    ap.add_argument("--ws-port", type=int, default=8766, help="WebSocket port the app connects to (default 8766)")
    ap.add_argument("--allow-origin", action="append", default=[], help="extra page origin allowed to connect")
    ap.add_argument("--any-origin", action="store_true", help="allow any web page to connect (not recommended)")
    a = ap.parse_args()
    origins = DEFAULT_ORIGINS | set(a.allow_origin)
    server = await asyncio.start_server(lambda r, w: handle(r, w, origins, a.any_origin), "127.0.0.1", a.ws_port)
    print("Body Multi-Tracker · OSC bridge", flush=True)
    print(f"  waiting for the app on ws://localhost:{a.ws_port}", flush=True)
    print(f"  OSC goes to {bridge.host}:{bridge.port} (change it in the app's OSC OUT panel)", flush=True)
    print("  leave this window open while you perform · Ctrl+C to stop", flush=True)
    asyncio.create_task(report())
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  bridge stopped", flush=True)
    except OSError as e:
        print(f"\nCould not start the bridge: {e}\nIs it already running in another window?", file=sys.stderr)
        sys.exit(1)
