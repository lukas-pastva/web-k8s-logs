import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import cfg from "./config.js";

/* --------- K8s helpers ----------------------------------------- */
let ca;
try { ca = fs.readFileSync(cfg.k8sCaPath); } catch { /* no CA */ }

const k8sAgent = new https.Agent({ ca, rejectUnauthorized: Boolean(ca) });
const k8sHeaders = cfg.k8sToken ? { Authorization: `Bearer ${cfg.k8sToken}` } : {};

async function k8sFetch(path) {
  const url = `${cfg.k8sApiUrl}${path}`;
  const mod = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: k8sHeaders, agent: k8sAgent }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`K8s ${res.statusCode}: ${body}`));
        resolve(JSON.parse(body));
      });
    });
    req.on("error", reject);
  });
}

function k8sStream(path) {
  const url = `${cfg.k8sApiUrl}${path}`;
  const mod = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: k8sHeaders, agent: k8sAgent }, (res) => {
      if (res.statusCode !== 200) {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => reject(new Error(`K8s ${res.statusCode}: ${body}`)));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });
}

/* --------- Express --------------------------------------------- */
const app = express();

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
      },
    },
  }),
);

app.use(express.json());
app.use(express.static("public"));
app.get("/favicon.ico", (_q, r) => r.status(204).end());

/* -- List namespaces -------------------------------------------- */
app.get("/api/namespaces", async (_req, res) => {
  try {
    if (cfg.k8sNamespace) {
      return res.json([cfg.k8sNamespace]);
    }
    const data = await k8sFetch("/api/v1/namespaces");
    const names = (data.items || []).map((n) => n.metadata.name).sort();
    res.json(names);
  } catch (e) {
    console.error("[ns] error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

/* -- List pods in namespace ------------------------------------- */
app.get("/api/namespaces/:ns/pods", async (req, res) => {
  try {
    const data = await k8sFetch(`/api/v1/namespaces/${encodeURIComponent(req.params.ns)}/pods`);
    const pods = (data.items || []).map((p) => ({
      name: p.metadata.name,
      status: p.status.phase,
      containers: (p.spec.containers || []).map((c) => c.name),
      initContainers: (p.spec.initContainers || []).map((c) => c.name),
    }));
    res.json(pods);
  } catch (e) {
    console.error("[pods] error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

/* -- Get logs (non-streaming) ----------------------------------- */
app.get("/api/namespaces/:ns/pods/:pod/logs", async (req, res) => {
  const { ns, pod } = req.params;
  const { container, tailLines = "500", previous } = req.query;
  let path = `/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(pod)}/log?tailLines=${tailLines}&timestamps=true`;
  if (container) path += `&container=${encodeURIComponent(container)}`;
  if (previous === "true") path += "&previous=true";
  try {
    const stream = await k8sStream(path);
    res.type("text/plain");
    stream.pipe(res);
  } catch (e) {
    console.error("[logs] error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

/* --------- HTTP + WebSocket server ----------------------------- */
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/api/ws/logs" });

wss.on("connection", (ws) => {
  let logStream = null;

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    /* stop previous stream */
    if (logStream) { logStream.destroy(); logStream = null; }

    const { namespace, pod, container, tailLines = 100 } = msg;
    if (!namespace || !pod) return;

    let path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?follow=true&tailLines=${tailLines}&timestamps=true`;
    if (container) path += `&container=${encodeURIComponent(container)}`;

    console.log(`[ws] streaming ${namespace}/${pod}/${container || "default"}`);

    try {
      logStream = await k8sStream(path);
      logStream.on("data", (chunk) => {
        if (ws.readyState === ws.OPEN) ws.send(chunk.toString());
      });
      logStream.on("end", () => {
        if (ws.readyState === ws.OPEN) ws.send("\n[stream ended]");
      });
      logStream.on("error", (e) => {
        if (ws.readyState === ws.OPEN) ws.send(`\n[stream error: ${e.message}]`);
      });
    } catch (e) {
      if (ws.readyState === ws.OPEN) ws.send(`\n[error: ${e.message}]`);
    }
  });

  ws.on("close", () => {
    if (logStream) { logStream.destroy(); logStream = null; }
  });
});

server.listen(cfg.port, () => console.log(`web-k8s-logs listening on ${cfg.port}`));
