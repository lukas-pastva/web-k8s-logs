import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [namespaces, setNamespaces] = useState([]);
  const [ns, setNs] = useState("");
  const [pods, setPods] = useState([]);
  const [pod, setPod] = useState("");
  const [container, setContainer] = useState("");
  const [containers, setContainers] = useState([]);
  const [lines, setLines] = useState([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [events, setEvents] = useState([]);
  const [showEvents, setShowEvents] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  const wsRef = useRef(null);
  const logRef = useRef(null);

  /* theme */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  /* human-readable age */
  const formatAge = (isoDate) => {
    if (!isoDate) return "";
    const diff = Date.now() - new Date(isoDate).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  /* fetch namespaces on mount */
  useEffect(() => {
    fetch("/api/namespaces")
      .then((r) => r.json())
      .then(setNamespaces)
      .catch(() => {});
  }, []);

  /* fetch pods when namespace changes */
  useEffect(() => {
    if (!ns) { setPods([]); setPod(""); return; }
    fetch(`/api/namespaces/${encodeURIComponent(ns)}/pods`)
      .then((r) => r.json())
      .then((p) => { setPods(p); setPod(""); setContainer(""); })
      .catch(() => {});
  }, [ns]);

  /* set containers when pod changes */
  useEffect(() => {
    if (!pod) { setContainers([]); setContainer(""); return; }
    const p = pods.find((x) => x.name === pod);
    if (p) {
      const all = [...(p.initContainers || []), ...(p.containers || [])];
      setContainers(all);
      setContainer(all.length === 1 ? all[0] : "");
    }
  }, [pod, pods]);

  /* auto-scroll */
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  /* start streaming */
  const startStream = useCallback(() => {
    if (!ns || !pod) return;
    /* close previous */
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    setLines([]);
    setStreaming(true);

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws/logs`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ namespace: ns, pod, container, tailLines: 500 }));
    };

    ws.onmessage = (e) => {
      const newLines = e.data.split("\n").filter((l) => l.length > 0);
      setLines((prev) => [...prev, ...newLines]);
    };

    ws.onclose = () => setStreaming(false);
    ws.onerror = () => setStreaming(false);
  }, [ns, pod, container]);

  /* stop streaming */
  const stopStream = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setStreaming(false);
  };

  /* download logs */
  const downloadLogs = () => {
    const text = filtered.join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pod || "logs"}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* parse line: split timestamp from message */
  const parseLine = (raw) => {
    const m = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/);
    return m ? { ts: m[1], msg: m[2] } : { ts: "", msg: raw };
  };

  /* filter */
  const SYSTEM_NS = ["kube-system", "kube-public", "kube-node-lease"];
  const visibleNamespaces = showSystem
    ? namespaces
    : namespaces.filter((n) => !SYSTEM_NS.includes(n.name));

  const filtered = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="app">
      <div className="header">
        <h1>K8s Logs</h1>

        <select value={ns} onChange={(e) => setNs(e.target.value)}>
          <option value="">-- namespace --</option>
          {visibleNamespaces.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name}{n.createdAt ? ` (${formatAge(n.createdAt)})` : ""}
            </option>
          ))}
        </select>

        <label className="system-ns-toggle">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
          />
          System
        </label>

        <select value={pod} onChange={(e) => setPod(e.target.value)}>
          <option value="">-- pod --</option>
          {pods.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.status}{p.createdAt ? `, ${formatAge(p.createdAt)}` : ""})
            </option>
          ))}
        </select>

        {containers.length > 1 && (
          <select value={container} onChange={(e) => setContainer(e.target.value)}>
            <option value="">-- container --</option>
            {containers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {!streaming ? (
          <button className="primary" onClick={startStream} disabled={!ns || !pod}>
            Stream
          </button>
        ) : (
          <button onClick={stopStream}>Stop</button>
        )}

        <button onClick={downloadLogs} disabled={lines.length === 0}>
          Download
        </button>

        <button
          onClick={() => {
            if (!ns) return;
            setShowEvents((v) => !v);
            if (!showEvents) {
              const url = pod
                ? `/api/namespaces/${encodeURIComponent(ns)}/events?pod=${encodeURIComponent(pod)}`
                : `/api/namespaces/${encodeURIComponent(ns)}/events`;
              fetch(url).then((r) => r.json()).then(setEvents).catch(() => setEvents([]));
            }
          }}
          disabled={!ns}
        >
          {showEvents ? "Hide Events" : "Events"}
        </button>

        <button
          className="theme-btn"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title="Toggle theme"
        >
          {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
        </button>
      </div>

      <div className="controls">
        <input
          type="text"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>

      {showEvents && (
        <div className="events-panel">
          <div className="events-title">Events{pod ? ` for ${pod}` : ` in ${ns}`}</div>
          {events.length === 0 ? (
            <div className="events-empty">No events found.</div>
          ) : (
            <table className="events-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Object</th>
                  <th>Message</th>
                  <th>Count</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr key={i} className={ev.type === "Warning" ? "event-warning" : ""}>
                    <td>{ev.type}</td>
                    <td>{ev.reason}</td>
                    <td>{ev.object}</td>
                    <td>{ev.message}</td>
                    <td>{ev.count}</td>
                    <td>{formatAge(ev.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="log-viewer" ref={logRef}>
        {filtered.length === 0 ? (
          <div className="empty">
            {streaming ? "Waiting for logs..." : "Select a namespace and pod, then click Stream."}
          </div>
        ) : (
          filtered.map((line, i) => {
            const { ts, msg } = parseLine(line);
            const isHighlight = filter && msg.toLowerCase().includes(filter.toLowerCase());
            return (
              <div key={i} className={`line${isHighlight ? " highlight" : ""}`}>
                {ts && <span className="ts">{ts}</span>}
                {msg}
              </div>
            );
          })
        )}
      </div>

      <div className="status-bar">
        <span>
          {streaming ? <span className="live">LIVE</span> : "Stopped"}
          {ns && pod ? ` | ${ns}/${pod}${container ? `/${container}` : ""}` : ""}
        </span>
        <span>{filtered.length} lines</span>
      </div>
    </div>
  );
}

export default App;
