"""Centralised paths, model identifiers, and API key lookup."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "src" / ".env")
load_dotenv(ROOT / ".env")

DATA = ROOT / "data"
OUTPUT = ROOT / "output"
DB = OUTPUT / "northbank.sqlite3"
RESULTS = OUTPUT / "results.json"

JEV_MODEL = "jev-latest"
CLAUDE_MODEL = "claude-haiku-4-5"
INJECTION_RISK_THRESHOLD = 0.65


def get_typesafe_api_key(override: str | None = None) -> str:
    return (override or os.environ.get("TYPESAFE_API_KEY") or "").strip()


def get_claude_api_key(override: str | None = None) -> str:
    return (override or os.environ.get("CLAUDE_API_KEY") or "").strip()
