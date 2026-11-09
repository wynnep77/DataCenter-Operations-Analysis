# Moving to Kubernetes (later phase)

The Compose stack maps one-to-one onto Kubernetes objects. Nothing in the images is Compose-specific.

| Compose service | Kubernetes | Notes |
|---|---|---|
| `ollama` | StatefulSet (1 replica) + PVC + ClusterIP Service | `resources.limits: nvidia.com/gpu: 1` (NVIDIA GPU Operator or device plugin). PVC ~20 GB for models. |
| `ollama-init` | Job (or an init container on the StatefulSet) | Runs `ollama pull $OLLAMA_MODEL` against the Service. |
| `api` | Deployment + ClusterIP Service | Env from a ConfigMap; `ADMIN_TOKEN` from a Secret. Probes: liveness `/healthz`, readiness `/readyz`. |
| `web` | Deployment + Service + Ingress | Set `API_UPSTREAM=<api-service>:8000`. The Ingress must not buffer `/api/` (SSE): for ingress-nginx use `nginx.ingress.kubernetes.io/proxy-buffering: "off"` and `proxy-read-timeout: "900"`. |

Points to carry over:

- Push the images to a registry: set `REGISTRY` and `TAG` in `.env`, then `docker compose build && docker compose push`.
- Keep Ollama at one replica per GPU. Scale the API and web freely (they hold no state).
- Keep the containers' security settings: run as non-root, read-only root filesystem, drop all capabilities.
- Health endpoints are already in place for probes: `/healthz`, `/readyz` (API) and `/nginx-health` (web).
