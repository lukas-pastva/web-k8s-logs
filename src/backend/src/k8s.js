import https from "node:https";
import fs from "node:fs";
import cfg from "./config.js";

let ca;
try { ca = fs.readFileSync(cfg.k8sCaPath); } catch { /* no CA */ }

const agent = new https.Agent({
  ca,
  rejectUnauthorized: Boolean(ca),
});

const headers = cfg.k8sToken
  ? { Authorization: `Bearer ${cfg.k8sToken}` }
  : {};

/** Fetch JSON from K8s API */
export async function k8sFetch(path) {
  const url = `${cfg.k8sApiUrl}${path}`;
  const res = await fetch(url, { headers, agent });
  if (!res.ok) throw new Error(`K8s API ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Stream logs from K8s API – returns a ReadableStream */
export function k8sStream(path) {
  const url = `${cfg.k8sApiUrl}${path}`;
  return new Promise((resolve, reject) => {
    const reqModule = url.startsWith("https") ? https : (await import("node:http")).default;
    const req = https.get(url, { headers, agent }, (res) => {
      if (res.statusCode !== 200) {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => reject(new Error(`K8s API ${res.statusCode}: ${body}`)));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
  });
}
