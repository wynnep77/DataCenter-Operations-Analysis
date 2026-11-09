"""API tests against a mocked Ollama (no network, no GPU). Run: python3 -m unittest discover -s tests -v"""
import json
import os
import sys
import unittest

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.prompts import build_messages, fit_context  # noqa: E402
from app.proposal import ThinkSplitter, extract_proposal  # noqa: E402


class FakeOllama:
    def __init__(self, chunks=None, models=("qwen3:8b",), reject_think=False, chat_status=200):
        self.chunks = chunks or ["Hello ", "operator."]
        self.models, self.reject_think, self.chat_status = models, reject_think, chat_status
        self.last_payload, self.calls = None, 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        p = req.url.path
        if p == "/api/version":
            return httpx.Response(200, json={"version": "0.12.0"})
        if p == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m, "model": m, "size": 5_200_000_000,
                                                         "details": {"parameter_size": "8.2B", "quantization_level": "Q4_K_M"}} for m in self.models]})
        if p == "/api/ps":
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b", "size": 8_000_000_000, "size_vram": 6_000_000_000,
                                                         "context_length": 12288}]})
        if p == "/api/chat":
            self.calls += 1
            self.last_payload = json.loads(req.content)
            if self.chat_status != 200:
                return httpx.Response(self.chat_status, json={"error": "model 'qwen3:8b' not found, try pulling it first"})
            if self.reject_think and "think" in self.last_payload:
                return httpx.Response(400, json={"error": "registry.ollama.ai/library/qwen3 does not support thinking"})
            lines = [json.dumps({"message": {"role": "assistant", "content": c}, "done": False}) for c in self.chunks]
            lines.append(json.dumps({"message": {"role": "assistant", "content": ""}, "done": True, "eval_count": 40,
                                     "eval_duration": 2_000_000_000, "prompt_eval_count": 900, "done_reason": "stop"}))
            return httpx.Response(200, content=("\n".join(lines) + "\n").encode(), headers={"Content-Type": "application/x-ndjson"})
        return httpx.Response(404, json={"error": "not found"})


def make(fake=None, **kw):
    fake = fake or FakeOllama()
    s = Settings(); s.ollama_url = "http://ollama.test"; s.admin_token = kw.pop("token", ""); s.model = "qwen3:8b"
    for k, v in kw.items():
        setattr(s, k, v)
    return TestClient(create_app(s, transport=httpx.MockTransport(fake))), fake


def events(resp):
    return [json.loads(l[5:]) for l in resp.text.splitlines() if l.startswith("data:")]


BODY = {"mode": "analyse", "messages": [{"role": "user", "content": "Analyse the current state"}],
        "context": {"simulated": True, "power": {"hallItKw": 770, "pueLive": 1.31}}}


class ApiTests(unittest.TestCase):
    def test_health_reports_model(self):
        c, _ = make()
        with c:
            h = c.get("/api/health").json()
        self.assertTrue(h["ollama"]); self.assertTrue(h["model_available"]); self.assertEqual(h["model"], "qwen3:8b")
        self.assertEqual(h["num_ctx"], 12288)

    def test_health_model_missing(self):
        c, _ = make(FakeOllama(models=("llama3:8b",)))
        with c:
            self.assertFalse(c.get("/api/health").json()["model_available"])

    def test_liveness_and_readiness(self):
        c, _ = make()
        with c:
            self.assertEqual(c.get("/healthz").json()["status"], "ok")
            self.assertEqual(c.get("/readyz").json()["status"], "ready")

    def test_auth_required(self):
        c, _ = make(token="s3cret")
        with c:
            self.assertTrue(c.get("/api/health").json()["auth_required"])
            self.assertEqual(c.post("/api/chat", json=BODY).status_code, 401)
            self.assertEqual(c.post("/api/auth/check", headers={"X-Admin-Token": "wrong"}).status_code, 401)
            self.assertEqual(c.post("/api/auth/check", headers={"X-Admin-Token": "s3cret"}).status_code, 200)

    def test_analyse_stream_and_context(self):
        c, fake = make()
        with c:
            r = c.post("/api/chat", json=BODY)
        self.assertEqual(r.headers["x-accel-buffering"], "no")
        ev = events(r)
        self.assertEqual([e["type"] for e in ev], ["start", "content", "content", "done"])
        self.assertEqual("".join(e["text"] for e in ev if e["type"] == "content"), "Hello operator.")
        self.assertEqual(ev[-1]["stats"]["tokens_per_s"], 20.0)
        sysmsg = fake.last_payload["messages"][0]
        self.assertEqual(sysmsg["role"], "system"); self.assertIn('"hallItKw":770', sysmsg["content"])
        self.assertIn("LIVE ANALYSIS", sysmsg["content"])
        self.assertEqual(fake.last_payload["options"]["num_ctx"], 12288); self.assertFalse(fake.last_payload["think"])

    def test_twin_proposal_clamped(self):
        txt = 'Verdict: near limits.\n```twin-proposal\n{"nodesPerRack": 12, "util": 95, "rationale": "more"}\n```'
        c, _ = make(FakeOllama(chunks=[txt[:30], txt[30:]]))
        with c:
            ev = events(c.post("/api/chat", json={**BODY, "mode": "twin"}))
        p = [e for e in ev if e["type"] == "proposal"][0]
        self.assertEqual(p["settings"], {"nodesPerRack": 8, "util": 0.95}); self.assertTrue(p["warnings"])
        self.assertEqual(ev[-1]["type"], "done")

    def test_analyse_mode_never_emits_proposal(self):
        c, _ = make(FakeOllama(chunks=['```twin-proposal\n{"util":0.9}\n```']))
        with c:
            self.assertFalse([e for e in events(c.post("/api/chat", json=BODY)) if e["type"] == "proposal"])

    def test_think_fallback(self):
        c, fake = make(FakeOllama(reject_think=True))
        with c:
            ev = events(c.post("/api/chat", json={**BODY, "think": True}))
        self.assertEqual(fake.calls, 2); self.assertNotIn("think", fake.last_payload)
        self.assertEqual(ev[-1]["type"], "done")

    def test_inline_think_tags_hidden_unless_requested(self):
        c, _ = make(FakeOllama(chunks=["<thi", "nk>secret plan</th", "ink>Answer"]))
        with c:
            ev = events(c.post("/api/chat", json=BODY))
            ev2 = events(c.post("/api/chat", json={**BODY, "think": True}))
        self.assertEqual("".join(e["text"] for e in ev if e["type"] == "content"), "Answer")
        self.assertFalse([e for e in ev if e["type"] == "thinking"])
        self.assertEqual("".join(e["text"] for e in ev2 if e["type"] == "thinking"), "secret plan")

    def test_model_not_allowed(self):
        c, _ = make()
        with c:
            self.assertEqual(c.post("/api/chat", json={**BODY, "model": "llama3:70b"}).status_code, 400)
            self.assertEqual(c.post("/api/chat", json={**BODY, "model": "qwen3:14b"}).status_code, 200)

    def test_context_too_large_drops_detail(self):
        big = {"power": {"hallItKw": 770}, "racks": [{"id": f"R{i}", "note": "x" * 200} for i in range(200)],
               "recentEvents": ["e" * 100] * 50}
        c, fake = make(max_context_chars=4000)
        with c:
            ev = events(c.post("/api/chat", json={**BODY, "context": big}))
        self.assertEqual(ev[0]["dropped_context"], ["recentEvents", "racks"])
        content = fake.last_payload["messages"][0]["content"]
        self.assertIn('"hallItKw":770', content); self.assertIn("Detail omitted", content)

    def test_runtime_gpu_pct(self):
        c, _ = make()
        with c:
            rt = c.get("/api/runtime").json()
        self.assertEqual(rt["loaded"][0]["gpu_pct"], 75); self.assertEqual(rt["loaded"][0]["context_length"], 12288)

    def test_model_missing_error_has_hint(self):
        c, _ = make(FakeOllama(chat_status=404))
        with c:
            ev = events(c.post("/api/chat", json=BODY))
        self.assertEqual(ev[-1]["type"], "error"); self.assertIn("ollama-init", ev[-1]["hint"])

    def test_ollama_down(self):
        def down(req):
            raise httpx.ConnectError("refused")
        c = TestClient(create_app(Settings(ollama_url="http://x", admin_token=""), transport=httpx.MockTransport(down)))
        with c:
            h = c.get("/api/health").json()
            self.assertFalse(h["ollama"]); self.assertIn("not reachable", h["detail"])
            self.assertEqual(c.get("/readyz").status_code, 503)
            ev = events(c.post("/api/chat", json=BODY))
        self.assertEqual(ev[-1]["type"], "error"); self.assertIn("docker compose", ev[-1]["hint"])

    def test_bad_request_rejected(self):
        c, _ = make()
        with c:
            self.assertEqual(c.post("/api/chat", json={**BODY, "mode": "hack"}).status_code, 422)
            self.assertEqual(c.post("/api/chat", json={**BODY, "messages": []}).status_code, 422)


class UnitTests(unittest.TestCase):
    def test_think_splitter_partial_tags(self):
        s, out = ThinkSplitter(), []
        for ch in ["<th", "ink>a", "b</thi", "nk>c", "<"]:
            out += s.feed(ch)
        out += s.flush()
        self.assertEqual("".join(t for k, t in out if k == "thinking"), "ab")
        self.assertEqual("".join(t for k, t in out if k == "content"), "c<")

    def test_no_proposal(self):
        self.assertIsNone(extract_proposal("No changes needed."))

    def test_bad_json(self):
        p = extract_proposal("```twin-proposal\n{nodes: 6}\n```")
        self.assertEqual(p["settings"], {}); self.assertIn("could not be parsed", p["warnings"][0])

    def test_nested_settings_accepted(self):
        p = extract_proposal('```twin-proposal\n{"settings":{"nodesPerRack":6,"util":0.9},"rationale":"Under 90%"}\n```')
        self.assertEqual(p["settings"], {"nodesPerRack": 6, "util": 0.9})
        self.assertEqual(p["rationale"], "Under 90%"); self.assertEqual(p["warnings"], [])

    def test_percent_strings_and_bools(self):
        p = extract_proposal('```twin-proposal\n{"util":"85%","dlcShare":80,"rearDoors":false,"tOut":40}\n```')
        self.assertEqual(p["settings"]["util"], 0.85); self.assertEqual(p["settings"]["dlcShare"], 0.8)
        self.assertIs(p["settings"]["rearDoors"], False); self.assertEqual(p["settings"]["tOut"], 35.0)

    def test_history_window_starts_with_user(self):
        hist = [{"role": "assistant", "content": "a"}, {"role": "user", "content": "u1"}, {"role": "assistant", "content": "a1"},
                {"role": "user", "content": "u2"}]
        msgs, _ = build_messages("twin", {}, hist, 1000, 2)   # window [a1, u2] -> leading assistant dropped
        self.assertEqual([m["role"] for m in msgs], ["system", "user"]); self.assertIn("DIGITAL TWIN ADVISOR", msgs[0]["content"])

    def test_fit_context_truncates_last_resort(self):
        text, dropped = fit_context({"power": {"x": "y" * 500}}, 100)
        self.assertEqual(dropped[-1], "(truncated)"); self.assertLess(len(text), 130)


if __name__ == "__main__":
    unittest.main()
