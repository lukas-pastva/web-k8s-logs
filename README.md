# Web K8s Logs

A web UI for viewing Kubernetes pod logs in real-time.
Single container: React frontend + Express backend.

---

## Features

- **Live log streaming** -- real-time log tailing via WebSocket
- **Namespace / Pod / Container selection** -- browse and select from dropdowns
- **Search & filter** -- filter log lines with text search
- **Dark / Light theme** -- toggle, persisted in localStorage
- **Auto-scroll** -- follows new log lines, pausable
- **Download logs** -- export current log view as a file

---

## Quick start

```bash
docker build -t web-k8s-logs ./src

docker run -p 8080:8080 \
  -e K8S_API_URL=https://kubernetes.default.svc \
  -e K8S_TOKEN=eyJhbGci... \
  web-k8s-logs
```

Open <http://localhost:8080>

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `K8S_API_URL` | `https://kubernetes.default.svc` | Kubernetes API server URL |
| `K8S_TOKEN` | -- | Service account token (auto-detected in-cluster) |
| `K8S_CA_PATH` | `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` | Path to CA certificate |
| `K8S_NAMESPACE` | -- | Restrict to a single namespace (optional) |
| `PORT` | `8080` | Port the server listens on |

---

## Kubernetes deployment

The container runs as a non-root user. It needs a ServiceAccount with `get`, `list`, `watch` permissions on `pods` and `pods/log`.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: web-k8s-logs
rules:
  - apiGroups: [""]
    resources: ["namespaces", "pods", "pods/log"]
    verbs: ["get", "list", "watch"]
```
