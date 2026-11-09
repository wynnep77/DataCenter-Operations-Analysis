"""Callan Operational Dashboard v2 - AI Analyst API.

The browser computes every number; this service adds the analyst instructions, streams the answer from a local
Ollama model as server-sent events, and extracts any Digital Twin proposal for the browser to evaluate.
"""
import asyncio
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import APP_VERSION, Settings
from .ollama_client import OllamaClient, OllamaError
from .prompts import build_messages
from .proposal import ThinkSplitter, extract_proposal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("dcoa.api")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=12000)


class ChatRequest(BaseModel):
    mode: Literal["analyse", "twin"] = "analyse"
    messages: List[ChatMessage] = Field(min_length=1, max_length=60)
    context: dict = Field(default_factory=dict)
    think: bool = False
    model: Optional[str] = None


def _hint(err: str, model: str) -> str:
    e = err.lower()
    if "not found" in e or "pull" in e or "404" in e:
        return f"Model '{model}' is not pulled. On the Docker host run: docker compose run --rm ollama-init"
    if "not reachable" in e or "connection" in e:
        return "Ollama is not reachable from the API. Check: docker compose ps, docker compose logs ollama"
    if "memory" in e or "cuda" in e:
        return "The GPU ran out of memory. Lower OLLAMA_NUM_CTX or use qwen3:8b."
    return ""


def create_app(settings: Optional[Settings] = None, transport=None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.ollama = OllamaClient(settings.ollama_url, settings.request_timeout, transport=transport)
        app.state.sem = asyncio.Semaphore(max(1, settings.max_concurrent))
        log.info("API %s · Ollama %s · model %s · ctx %d", APP_VERSION, settings.ollama_url, settings.model, settings.num_ctx)
        yield
        await app.state.ollama.aclose()

    app = FastAPI(title="Callan Operational Dashboard - AI Analyst API", version=APP_VERSION, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.settings = settings
    if settings.cors_origins:     # not needed behind the bundled nginx (same origin)
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"],
                           allow_headers=["Content-Type", "X-Admin-Token"])

    def require_admin(x_admin_token: Optional[str] = Header(default=None)):
        if settings.admin_token and not hmac.compare_digest(x_admin_token or "", settings.admin_token):
            raise HTTPException(status_code=401, detail="Administrator token required")

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    async def readyz(request: Request):
        try:
            await request.app.state.ollama.version()
            return {"status": "ready"}
        except OllamaError as e:
            return JSONResponse({"status": "not-ready", "detail": str(e)}, status_code=503)

    @app.get("/api/health")
    async def health(request: Request):
        out = {"api": "ok", "version": APP_VERSION, "model": settings.model, "auth_required": bool(settings.admin_token),
               "ollama": False, "ollama_version": None, "model_available": False, "num_ctx": settings.num_ctx}
        client: OllamaClient = request.app.state.ollama
        try:
            out["ollama_version"] = await client.version()
            out["ollama"] = True
            tags = await client.tags()
            names = {m.get("name") for m in tags} | {m.get("model") for m in tags}
            out["model_available"] = settings.model in names or f"{settings.model}:latest" in names
        except OllamaError as e:
            out["detail"] = str(e)
        return out

    @app.post("/api/auth/check", dependencies=[Depends(require_admin)])
    async def auth_check():
        return {"ok": True}

    @app.get("/api/models", dependencies=[Depends(require_admin)])
    async def models(request: Request):
        try:
            tags = await request.app.state.ollama.tags()
        except OllamaError as e:
            raise HTTPException(status_code=503, detail=str(e))
        avail = []
        for m in tags:
            d = m.get("details") or {}
            avail.append({"name": m.get("name"), "size_gb": round((m.get("size") or 0) / 1e9, 1),
                          "parameters": d.get("parameter_size"), "quantization": d.get("quantization_level"),
                          "allowed": m.get("name") in settings.allowed_models})
        return {"default": settings.model, "allowed": list(settings.allowed_models), "available": avail}

    @app.get("/api/runtime", dependencies=[Depends(require_admin)])
    async def runtime(request: Request):
        """Which models are loaded and how much of each sits in GPU memory (100 % = fully on the GPU)."""
        try:
            ps = await request.app.state.ollama.ps()
        except OllamaError as e:
            raise HTTPException(status_code=503, detail=str(e))
        loaded = []
        for m in ps:
            size, vram = m.get("size") or 0, m.get("size_vram") or 0
            loaded.append({"name": m.get("name"), "size": size, "size_vram": vram,
                           "gpu_pct": round(100 * vram / size) if size else 0,
                           "context_length": m.get("context_length"), "expires_at": m.get("expires_at")})
        return {"loaded": loaded}

    @app.post("/api/chat", dependencies=[Depends(require_admin)])
    async def chat(req: ChatRequest, request: Request):
        model = req.model or settings.model
        if model not in settings.allowed_models and model != settings.model:
            raise HTTPException(status_code=400, detail=f"Model '{model}' is not in ALLOWED_MODELS")
        sem: asyncio.Semaphore = request.app.state.sem
        if sem.locked():
            raise HTTPException(status_code=429, detail="The analyst is busy with other requests; try again shortly")
        messages, dropped = build_messages(req.mode, req.context, [m.model_dump() for m in req.messages],
                                           settings.max_context_chars, settings.max_history)
        payload = {"model": model, "messages": messages, "think": req.think, "keep_alive": settings.keep_alive,
                   "options": {"num_ctx": settings.num_ctx, "temperature": settings.temperature}}
        client: OllamaClient = request.app.state.ollama

        async def events():
            def sse(obj) -> str:
                return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"

            async with sem:
                t0 = time.monotonic()
                yield sse({"type": "start", "model": model, "mode": req.mode, "dropped_context": dropped})
                full, stats, attempt_payload = "", {}, dict(payload)
                for attempt in (1, 2):
                    splitter = ThinkSplitter()
                    try:
                        async for chunk in client.chat_stream(attempt_payload):
                            if await request.is_disconnected():
                                log.info("client disconnected; stopping generation")
                                return
                            msg = chunk.get("message") or {}
                            if msg.get("thinking") and req.think:
                                yield sse({"type": "thinking", "text": msg["thinking"]})
                            for kind, text in splitter.feed(msg.get("content") or ""):
                                if kind == "content":
                                    full += text
                                    yield sse({"type": "content", "text": text})
                                elif req.think:
                                    yield sse({"type": "thinking", "text": text})
                            if chunk.get("done"):
                                stats = {k: chunk.get(k) for k in ("total_duration", "load_duration", "prompt_eval_count",
                                                                   "eval_count", "eval_duration", "done_reason")}
                        for kind, text in splitter.flush():
                            if kind == "content":
                                full += text
                                yield sse({"type": "content", "text": text})
                        break
                    except OllamaError as e:
                        if attempt == 1 and "think" in str(e).lower() and not full:
                            attempt_payload.pop("think", None)          # older Ollama / model without thinking support
                            continue
                        log.warning("chat failed: %s", e)
                        yield sse({"type": "error", "message": str(e), "hint": _hint(str(e), model)})
                        return
                if req.mode == "twin":
                    p = extract_proposal(full)
                    if p:
                        yield sse({"type": "proposal", **p})
                ec, ed = stats.get("eval_count") or 0, stats.get("eval_duration") or 0
                tps = round(ec / (ed / 1e9), 1) if ed else None
                log.info("chat mode=%s model=%s tokens=%s tps=%s wall=%.2fs", req.mode, model, ec, tps, time.monotonic() - t0)
                yield sse({"type": "done", "stats": {**stats, "tokens_per_s": tps}})

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app


app = create_app()
