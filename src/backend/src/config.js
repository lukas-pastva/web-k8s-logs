const config = {
  port: +(process.env.PORT || 8080),
  k8sApiUrl: process.env.K8S_API_URL || "https://kubernetes.default.svc",
  k8sToken: process.env.K8S_TOKEN || "",
  k8sCaPath: process.env.K8S_CA_PATH || "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
  k8sNamespace: process.env.K8S_NAMESPACE || "",
};

/* auto-detect in-cluster token if not provided */
if (!config.k8sToken) {
  try {
    const fs = await import("node:fs");
    config.k8sToken = fs.readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8").trim();
  } catch {
    /* not running in cluster */
  }
}

export default config;
