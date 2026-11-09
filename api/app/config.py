"""Runtime settings, read from environment variables (Docker/Kubernetes friendly)."""
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    ollama_url: str = field(default_factory=lambda: os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/"))
    model: str = field(default_factory=lambda: os.environ.get("OLLAMA_MODEL", "qwen3:8b"))
    num_ctx: int = field(default_factory=lambda: _int("OLLAMA_NUM_CTX", 12288))
    temperature: float = field(default_factory=lambda: _float("LLM_TEMPERATURE", 0.3))
    keep_alive: str = field(default_factory=lambda: os.environ.get("OLLAMA_KEEP_ALIVE", "30m"))
    request_timeout: float = field(default_factory=lambda: _float("LLM_TIMEOUT_SECONDS", 600))
    admin_token: str = field(default_factory=lambda: os.environ.get("ADMIN_TOKEN", ""))
    max_history: int = field(default_factory=lambda: _int("MAX_HISTORY_MESSAGES", 12))
    max_context_chars: int = field(default_factory=lambda: _int("MAX_CONTEXT_CHARS", 30000))
    max_concurrent: int = field(default_factory=lambda: _int("MAX_CONCURRENT_CHATS", 2))
    allowed_models: tuple = field(default_factory=lambda: tuple(
        m.strip() for m in os.environ.get("ALLOWED_MODELS", "qwen3:8b,qwen3:14b,qwen3:4b").split(",") if m.strip()))
    cors_origins: tuple = field(default_factory=lambda: tuple(
        o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()))


APP_VERSION = "2.0.0-dev"
