# Callan Operational Dashboard v2

v2 adds an **Administrator** tab to the locked v1.0 dashboard: a local AI operations analyst (Ollama) that can

- **Live analysis**: explain the current simulated state, the binding constraint, efficiency and alarms.
- **Twin advisor**: assess what-if scenarios and propose Digital Twin settings. The dashboard evaluates every proposal with
  its own model, the operator chooses **Apply to Digital Twin**, and **Undo apply** restores the previous configuration.

All data is synthetic. Nothing connects to live equipment. v1.0 (`../scfn_dashboard_v1.0.html`) is unchanged; v2 is built from it.

## Architecture

```
Browser ──► web (nginx :8080) ──/api/──► api (FastAPI :8000) ──► ollama (GPU, qwen3:8b)
             serves index.html            adds analyst prompt,      model weights in the
             (the whole dashboard)        streams SSE, parses        ollama-models volume
                                          proposals
```

- The **browser computes every number** (same simulation as v1). The model only reasons over a JSON snapshot.
- What-if scenarios and AI proposals are evaluated by the browser's steady-state model before anything is applied.
- The API never changes the hall. Applying goes through the dashboard's normal controls and is logged on the Live Console.
- Only the web container publishes a port. Ollama and the API stay on the internal Compose network.

## Deploy (single Docker host with an NVIDIA GPU)

Prerequisites: Docker Engine with Compose v2, an NVIDIA driver, and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
Check the GPU is visible to containers:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

Then:

```bash
git clone https://github.com/wynnep77/DataCenter-Operations-Analysis.git
cd DataCenter-Operations-Analysis
cp .env.example .env
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 24)/" .env
docker compose up -d --build              # starts ollama, pulls the model once (ollama-init), api, web
docker compose logs -f ollama-init        # first run downloads ~5 GB; wait for "models available"
./scripts/check-deployment.sh             # 8 checks: web, dashboard, API, Ollama, model, token, chat, GPU placement
```

Open `http://<host>:8080`, go to **Administrator**, and enter the `ADMIN_TOKEN` from `.env` when asked.
The first answer takes longer while the model loads into VRAM. It then stays loaded for `OLLAMA_KEEP_ALIVE` (30 min).

## GPU sizing (8-12 GB VRAM)

| Model | Weights (Q4_K_M) | Context | Approx. VRAM | Fits |
|---|---|---|---|---|
| `qwen3:8b` (default) | ~5.2 GB | 12,288 | ~6.5 GB | 8, 10 and 12 GB cards |
| `qwen3:14b` (optional) | ~9.3 GB | 8,192 | ~10.5 GB | 12 GB cards only |
| `qwen3:4b` (fallback) | ~2.5 GB | 12,288 | ~3.5 GB | any; weaker analysis |

VRAM figures are estimates: weights plus a q8_0 KV cache plus runtime overhead. Check the real placement with
`./scripts/check-deployment.sh` or `docker compose exec ollama ollama ps`. Anything below 100 % GPU means it spilled
to the CPU and will be much slower.

To try `qwen3:14b` on a 12 GB card:

```bash
# .env
OLLAMA_MODEL=qwen3:14b
OLLAMA_NUM_CTX=8192
docker compose run --rm ollama-init && docker compose up -d api
```

The Twin advisor context is about 5,000 characters (about 1,500 tokens). With history and the answer, 8,192 tokens is enough;
12,288 leaves room for longer chats.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_TOKEN` | required | Shared secret for the Administrator tab (`X-Admin-Token` header) |
| `OLLAMA_MODEL` | `qwen3:8b` | Model used by the analyst |
| `OLLAMA_EXTRA_MODELS` | empty | Extra models for `ollama-init` to pull (comma separated) |
| `ALLOWED_MODELS` | `qwen3:8b,qwen3:14b,qwen3:4b` | Models a request may ask for |
| `OLLAMA_NUM_CTX` | `12288` | Context window (tokens). Lower it if the model spills to the CPU |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | KV-cache quantisation (halves cache VRAM versus f16) |
| `OLLAMA_KEEP_ALIVE` | `30m` | How long the model stays in VRAM after the last request |
| `LLM_TEMPERATURE` | `0.3` | Lower = more consistent analysis |
| `MAX_CONCURRENT_CHATS` | `2` | Further requests get HTTP 429 |
| `MAX_CONTEXT_CHARS` | `30000` | Snapshot budget; detail sections are dropped first if exceeded |
| `WEB_BIND` / `WEB_PORT` | `0.0.0.0` / `8080` | Published address. Use `127.0.0.1` behind a TLS reverse proxy |

## Operations

```bash
docker compose ps                         # health of all services
docker compose logs -f api                # one line per chat: mode, model, tokens, tokens/s
docker compose exec ollama ollama ps      # loaded model and GPU %
docker compose pull ollama && docker compose up -d         # update Ollama
docker compose up -d --build web api                       # deploy a new dashboard or API build
docker compose down                       # stop (the model volume is kept)
```

**Security:** the token is a shared secret held in the browser's local storage. Run on a trusted network, or put a
TLS reverse proxy or SSO in front of port 8080. Model output is escaped before display, and proposals are clamped
to the dashboard's lever ranges.

## Develop and test (no Docker or GPU needed)

```bash
pip install -r api/requirements.txt       # Python 3.12; Node 18+ for the browser tests
./scripts/test-all.sh                     # build reproducibility, smoke test, Administrator tests, API tests
python3 tools/build/build_v2.py           # rebuild web/html/index.html after editing tools/build/admin_*.{js,css}
```

| Path | Contents |
|---|---|
| `tools/build/build_v2.py` | Builds `web/html/index.html` from v1.0 (fingerprint-checked, anchors must match exactly once) |
| `tools/build/admin_js.js`, `admin_css.css` | Administrator tab source: snapshot, what-if evaluator, chat, apply/undo |
| `tools/test/smoke_test.js` | Headless dashboard smoke test (all tabs, 300+ ticks, error count) |
| `tools/test/test_admin.js` | 40 checks: snapshot, evaluator vs live model, physics sanity, apply/undo, proposal card, Markdown safety, streamed chat |
| `api/` | FastAPI service, Dockerfile and 22 tests against a mocked Ollama |
| `web/` | nginx image, config template and the built dashboard |
| `scripts/` | Model pull job, post-deploy check, test runner |

You can still open `web/html/index.html` straight from disk. Every tab works offline, and the Administrator tab
explains that the AI needs the Docker deployment.

## Limits

- The what-if evaluator is steady state. It ignores fault transients and uses the live CRAC and CDU availability.
- The SFN supply lever is the Digital Twin what-if temperature. Applying it sets the Twin to Manual; it does not change
  the live CDU set-point (as in v1).
- AI answers can be wrong. The dashboard's figures are authoritative.
