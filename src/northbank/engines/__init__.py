"""Composable triage engine protocol and factory."""
from __future__ import annotations

from typing import Any, Protocol

from ..domain import GroundedContext
from .claude import ClaudeEngine, recommend_claude
from .jev import JevEngine, recommend_jev


class TriageEngine(Protocol):
    """Contract shared by interchangeable triage decision engines."""

    name: str

    def recommend(self, context: GroundedContext) -> dict[str, Any]: ...


ENGINE_REGISTRY: dict[str, type[JevEngine | ClaudeEngine]] = {
    "jev": JevEngine,
    "claude": ClaudeEngine,
}


def create_engine(engine: str = "jev", api_key: str | None = None) -> TriageEngine:
    key = (engine or "jev").strip().lower()
    engine_cls = ENGINE_REGISTRY.get(key)
    if engine_cls is None:
        raise ValueError(f"Unsupported triage engine: {engine!r}")
    return engine_cls(api_key=api_key)


__all__ = [
    "ClaudeEngine",
    "ENGINE_REGISTRY",
    "JevEngine",
    "TriageEngine",
    "create_engine",
    "recommend_claude",
    "recommend_jev",
]
