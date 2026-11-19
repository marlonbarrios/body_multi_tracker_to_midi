// OSC OUT: sends the points' numbers to the OSC bridge (osc_bridge.py) over a local WebSocket.
// The bridge turns them into real OSC messages for TouchDesigner, Max, Pd, Processing…
//
// Addresses (N = body number 1–4, point = the point's id, e.g. hand_r, nose, index_l):
//   /body/N/point/raw    f f   raw position 0–1 (X: 0 left → 1 right, Y: 0 bottom → 1 top)
//   /body/N/point/out    f f   the mapped values (your ⚙ range output)
//   /body/N/tracked      i     1 = this body is seen, 0 = lost (sent on change and every second)
(function () {
  const O = window.OSC = {
    ws: null,
    connected: false,
    bridgeRate: 0,     // messages/s the bridge reports sending
    dest: '',          // "host:port" the bridge is sending to
    error: '',
    queue: [],
    sample: '',        // one recent message, for the panel
    lastTracked: {},
    lastTrackedSent: 0,
    retry: null,
    lna: '',           // Chrome's "local network access" permission (live app only): granted / prompt / denied

    // The live app (https) needs Chrome's "local network access" permission to reach the bridge on
    // this computer. Watch it so the panel can explain what to click.
    async watchPermission() {
      if (location.protocol !== 'https:' || !navigator.permissions) return;
      try {
        const p = await navigator.permissions.query({ name: 'local-network-access' });
        O.lna = p.state;
        p.onchange = () => { O.lna = p.state; if (p.state === 'granted') O.reconnect(); };
      } catch { /* older Chrome: no such permission, nothing to do */ }
    },

    // Connect when OSC is on; keep retrying every 2 s while the bridge isn't running.
    update() {
      if (!UI.oscOn) { O.close(); return; }
      if (!O.lnaWatched) { O.lnaWatched = true; O.watchPermission(); }
      if (O.ws && (O.ws.readyState === 0 || O.ws.readyState === 1)) return;
      clearTimeout(O.retry);
      let ws;
      try { ws = new WebSocket(UI.oscUrl); } catch (e) { O.error = e.message; O.scheduleRetry(); return; }
      O.ws = ws;
      ws.onopen = () => { O.connected = true; O.error = ''; O.configure(); };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'status') { O.bridgeRate = m.rate; O.dest = `${m.host}:${m.port}`; }
          if (m.type === 'error') O.error = m.error;
        } catch {}
      };
      ws.onclose = () => { O.connected = false; O.ws = null; O.scheduleRetry(); };
      ws.onerror = () => {};
    },
    scheduleRetry() { clearTimeout(O.retry); if (UI.oscOn) O.retry = setTimeout(O.update, 2000); },
    close() {
      clearTimeout(O.retry);
      if (O.ws) { O.ws.onclose = null; try { O.ws.close(); } catch {} }
      O.ws = null; O.connected = false;
    },
    reconnect() { O.close(); O.update(); },
    // Tell the bridge where to send (IP + port from the panel).
    configure() {
      if (O.connected) O.ws.send(JSON.stringify({ type: 'config', host: UI.oscHost, port: UI.oscPort }));
    },

    add(address, types, args) { O.queue.push([address, types, args]); },
    flush() {
      if (!O.queue.length) return;
      if (O.connected && O.ws.bufferedAmount < 1e6) {
        O.ws.send(JSON.stringify({ type: 'batch', m: O.queue }));
        const [a, , v] = O.queue[O.queue.length - 1];
        O.sample = a + '  ' + v.map((x) => (Number.isInteger(x) ? x : x.toFixed(3))).join('  ');
      }
      O.queue = [];
    },
  };
})();
