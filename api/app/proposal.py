"""Parse and sanitise the AI's ```twin-proposal``` block. The browser re-evaluates it before anything is applied."""
import json
import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

# Lever ranges (match the dashboard's controls). dlcRacks max assumes the default single air-cooled rack;
# the dashboard clamps again to the real number of free DLC positions.
LIMITS = {"nodesPerRack": (1, 8), "util": (0.10, 1.0), "dlcRacks": (1, 23), "dlcShare": (0.0, 1.0),
          "tOut": (-5.0, 35.0), "secSupply": (16.0, 30.0)}


class TwinProposal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nodesPerRack: Optional[int] = None
    util: Optional[float] = None
    dlcRacks: Optional[int] = None
    rearDoors: Optional[bool] = None
    dlcShare: Optional[float] = None
    tOut: Optional[float] = None
    secSupply: Optional[float] = None
    rationale: str = Field(default="", max_length=600)

    @field_validator("util", "dlcShare", mode="before")
    @classmethod
    def pct_to_fraction(cls, v):
        """Models often answer 90 instead of 0.9 for percentages."""
        if isinstance(v, str):
            v = v.strip().rstrip("%").strip()
        try:
            f = float(v)
        except (TypeError, ValueError):
            return v
        return f / 100.0 if f > 1.0 else f

    @field_validator("nodesPerRack", "dlcRacks", mode="before")
    @classmethod
    def round_int(cls, v):
        try:
            return int(round(float(v)))
        except (TypeError, ValueError):
            return v


_BLOCK = re.compile(r"```[ \t]*twin-proposal[ \t]*\r?\n(.*?)```", re.S | re.I)
_JSON_FALLBACK = re.compile(r"```(?:json)?[ \t]*\r?\n(\{.*?\})\s*```", re.S)


def extract_proposal(text: str) -> Optional[dict]:
    """Return {"settings": {...}, "rationale": str, "warnings": [...]} or None."""
    m = _BLOCK.search(text) or None
    raw = m.group(1) if m else None
    if raw is None:
        fb = _JSON_FALLBACK.search(text)
        if fb and any(k in fb.group(1) for k in ("nodesPerRack", "dlcRacks", "util")):
            raw = fb.group(1)
    if raw is None:
        return None
    try:
        data = json.loads(raw.strip())
        # Small models sometimes nest the levers: {"settings": {...}, "rationale": "..."}. Accept both shapes.
        if isinstance(data, dict) and isinstance(data.get("settings"), dict):
            data = {**data["settings"], **{k: v for k, v in data.items() if k != "settings"}}
        p = TwinProposal.model_validate(data)
    except (ValueError, ValidationError) as e:
        return {"settings": {}, "rationale": "", "warnings": [f"Proposal could not be parsed: {str(e)[:160]}"]}
    settings, warnings = {}, []
    for k, v in p.model_dump(exclude={"rationale"}).items():
        if v is None:
            continue
        if k in LIMITS:
            lo, hi = LIMITS[k]
            c = min(max(v, lo), hi)
            if c != v:
                warnings.append(f"{k} {v} is outside {lo}-{hi}; clamped to {c}")
            v = c
        settings[k] = v
    if not settings:
        warnings.append("Proposal block contained no recognised settings")
    return {"settings": settings, "rationale": p.rationale, "warnings": warnings}


class ThinkSplitter:
    """Separates <think>...</think> reasoning from the answer in a token stream, even when a tag is split
    across chunks. Used when a model emits reasoning inline instead of in Ollama's separate `thinking` field."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self):
        self.buf, self.inside = "", False

    def feed(self, text: str):
        self.buf += text
        out = []
        while self.buf:
            tag = self.CLOSE if self.inside else self.OPEN
            i = self.buf.find(tag)
            if i >= 0:
                if i:
                    out.append(("thinking" if self.inside else "content", self.buf[:i]))
                self.buf, self.inside = self.buf[i + len(tag):], not self.inside
                continue
            keep = 0                                   # hold back a possible partial tag at the end
            for n in range(min(len(tag) - 1, len(self.buf)), 0, -1):
                if tag.startswith(self.buf[-n:]):
                    keep = n
                    break
            emit = self.buf[:len(self.buf) - keep]
            if emit:
                out.append(("thinking" if self.inside else "content", emit))
            self.buf = self.buf[len(self.buf) - keep:]
            break
        return out

    def flush(self):
        out = [("thinking" if self.inside else "content", self.buf)] if self.buf else []
        self.buf = ""
        return out
