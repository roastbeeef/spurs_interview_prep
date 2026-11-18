"""SQLite audit + approval boundary and shared data/results persistence."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Iterator
import uuid

from .config import DATA, DB, RESULTS
from .domain import ALLOWED_ACTIONS, ALLOWED_DECISION_TYPES, extract_ticket_id

_CURRENT_TICKET_ID: ContextVar[str | None] = ContextVar("northbank_ticket_id", default=None)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def ticket_context(ticket_id: str) -> Iterator[None]:
    """Bind ticket_id for in-process audit calls without leaking across concurrent tasks."""
    token = _CURRENT_TICKET_ID.set(ticket_id)
    prev_env = os.environ.get("NORTHBANK_TICKET_ID")
    os.environ["NORTHBANK_TICKET_ID"] = ticket_id
    try:
        yield
    finally:
        _CURRENT_TICKET_ID.reset(token)
        if prev_env is None:
            os.environ.pop("NORTHBANK_TICKET_ID", None)
        else:
            os.environ["NORTHBANK_TICKET_ID"] = prev_env


def connect() -> sqlite3.Connection:
    db_path = Path(DB)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=10000")
    con.execute(
        """CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
          ticket_id TEXT, event TEXT NOT NULL, inputs TEXT NOT NULL, result TEXT NOT NULL
        )"""
    )
    con.execute(
        """CREATE TABLE IF NOT EXISTS cases (
          case_id TEXT PRIMARY KEY, preview_id TEXT NOT NULL UNIQUE,
          member_id TEXT NOT NULL, category TEXT NOT NULL, summary TEXT NOT NULL,
          approved_at TEXT NOT NULL
        )"""
    )
    con.execute(
        """CREATE TABLE IF NOT EXISTS staff_actions (
          ticket_id TEXT PRIMARY KEY,
          recommended_action TEXT NOT NULL,
          final_action TEXT NOT NULL,
          decision_type TEXT NOT NULL,
          reply_text TEXT,
          notes TEXT,
          case_id TEXT,
          preview_id TEXT,
          engine TEXT,
          actor TEXT NOT NULL,
          acted_at TEXT NOT NULL
        )"""
    )
    con.commit()
    return con


def audit(event: str, inputs: Any, result: Any, ticket_id: str | None = None) -> None:
    tid = (
        ticket_id
        if ticket_id is not None
        else (_CURRENT_TICKET_ID.get() or os.environ.get("NORTHBANK_TICKET_ID"))
    )
    with connect() as con:
        con.execute(
            "INSERT INTO audit (at,ticket_id,event,inputs,result) VALUES (?,?,?,?,?)",
            (now(), tid, event, json.dumps(inputs, default=str), json.dumps(result, default=str)),
        )


def trace(ticket_id: str) -> list[dict[str, Any]]:
    with connect() as con:
        rows = con.execute("SELECT * FROM audit WHERE ticket_id=? ORDER BY id", (str(ticket_id),)).fetchall()
        return [dict(r) for r in rows]


def recent_audit(limit: int = 40) -> list[dict[str, Any]]:
    bounded = max(1, min(limit, 200))
    with connect() as con:
        rows = con.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (bounded,)).fetchall()
        return [dict(r) for r in rows]


def eval_audit_rows() -> list[dict[str, Any]]:
    """Return ordered engine evaluation audit rows for latency telemetry."""
    with connect() as con:
        rows = con.execute(
            """SELECT id, at, ticket_id, event, inputs, result
               FROM audit
               WHERE event IN ('jev_system_one_eval', 'claude_system_two_eval')
               ORDER BY id ASC"""
        ).fetchall()
        return [dict(r) for r in rows]


def _read_csv(filename: str) -> list[dict[str, str]]:
    path = DATA / filename
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def members() -> list[dict[str, str]]:
    """Read member directory records from data/members.csv, normalising full name."""
    rows = _read_csv("members.csv")
    normalised: list[dict[str, str]] = []
    for row in rows:
        item = dict(row)
        if not str(item.get("name", "")).strip():
            full_name = f"{item.get('first_name', '').strip()} {item.get('last_name', '').strip()}".strip()
            if full_name:
                item["name"] = full_name
        normalised.append(item)
    return normalised


def fixtures() -> list[dict[str, str]]:
    return _read_csv("fixtures.csv")


def transactions() -> list[dict[str, str]]:
    return _read_csv("transactions.csv")


def find_member(member_id: str) -> dict[str, str] | None:
    return next(
        (m for m in members() if str(m.get("member_id", "")).lower() == str(member_id).lower()),
        None,
    )


def _require_pending_preview(
    con: sqlite3.Connection, preview_id: str, ticket_id: str
) -> dict[str, Any]:
    rows = con.execute(
        "SELECT result FROM audit WHERE event='create_case' AND ticket_id=? ORDER BY id DESC",
        (str(ticket_id),),
    ).fetchall()
    preview = next(
        (json.loads(r["result"]) for r in rows if json.loads(r["result"]).get("preview_id") == preview_id),
        None,
    )
    if not preview or preview.get("status") != "preview":
        raise ValueError("No valid, audited case proposal for this ticket")
    if con.execute("SELECT 1 FROM cases WHERE preview_id=?", (preview_id,)).fetchone():
        raise ValueError("Already approved")
    if con.execute(
        "SELECT 1 FROM audit WHERE event='rejection' AND ticket_id=? AND json_extract(inputs,'$.preview_id')=?",
        (str(ticket_id), preview_id),
    ).fetchone():
        raise ValueError("Proposal already rejected")
    return preview


def _approve_case_conn(
    con: sqlite3.Connection, preview_id: str, ticket_id: str, actor: str = "staff"
) -> dict[str, Any]:
    preview = _require_pending_preview(con, preview_id, ticket_id)
    if find_member(preview["member_id"]) is None:
        raise ValueError("Member no longer matched")

    case = {
        "case_id": str(uuid.uuid4()),
        "preview_id": preview_id,
        "member_id": preview["member_id"],
        "category": preview["category"],
        "summary": preview["summary"],
        "approved_at": now(),
    }
    con.execute(
        "INSERT INTO cases VALUES (:case_id,:preview_id,:member_id,:category,:summary,:approved_at)",
        case,
    )
    con.execute(
        "INSERT INTO audit (at,ticket_id,event,inputs,result) VALUES (?,?,?,?,?)",
        (
            now(),
            str(ticket_id),
            "approval",
            json.dumps({"preview_id": preview_id, "actor": actor}),
            json.dumps(case),
        ),
    )
    return case


def _reject_case_conn(
    con: sqlite3.Connection, preview_id: str, ticket_id: str, actor: str = "staff"
) -> dict[str, Any]:
    _require_pending_preview(con, preview_id, ticket_id)

    result = {"status": "rejected", "preview_id": preview_id}
    con.execute(
        "INSERT INTO audit (at,ticket_id,event,inputs,result) VALUES (?,?,?,?,?)",
        (
            now(),
            str(ticket_id),
            "rejection",
            json.dumps({"preview_id": preview_id, "actor": actor}),
            json.dumps(result),
        ),
    )
    return result


def approve_case(preview_id: str, ticket_id: str, actor: str = "staff") -> dict[str, Any]:
    """Only staff code calls this. Revalidates preview against actual MCP audit."""
    with connect() as con:
        return _approve_case_conn(con, preview_id, ticket_id, actor=actor)


def reject_case(preview_id: str, ticket_id: str, actor: str = "staff") -> dict[str, Any]:
    with connect() as con:
        return _reject_case_conn(con, preview_id, ticket_id, actor=actor)


def record_staff_action(
    ticket_id: str,
    recommended_action: str,
    final_action: str,
    decision_type: str = "accept",
    reply_text: str = "",
    notes: str = "",
    preview_id: str | None = None,
    engine: str = "jev",
    actor: str = "staff",
) -> dict[str, Any]:
    """Record a staff member's action (accept, reject_case, or override) atomically in SQLite."""
    if decision_type not in ALLOWED_DECISION_TYPES:
        raise ValueError(f"Invalid decision_type: {decision_type}")
    if decision_type != "reject_case" and final_action not in ALLOWED_ACTIONS:
        raise ValueError(f"Invalid final_action: {final_action}")
    if final_action == "create_case" and decision_type == "accept" and not preview_id:
        raise ValueError("Cannot accept create_case without a valid case preview_id")

    tid = str(ticket_id)
    acted_at = now()
    with connect() as con:
        case_id = None
        if final_action == "create_case" and decision_type == "accept" and preview_id:
            existing = con.execute("SELECT case_id FROM cases WHERE preview_id=?", (preview_id,)).fetchone()
            if existing:
                case_id = existing["case_id"]
            else:
                case = _approve_case_conn(con, preview_id, tid, actor=actor)
                case_id = case["case_id"]
        elif recommended_action == "create_case" and decision_type == "reject_case" and preview_id:
            already_rejected = con.execute(
                "SELECT 1 FROM audit WHERE event='rejection' AND ticket_id=? AND json_extract(inputs,'$.preview_id')=?",
                (tid, preview_id),
            ).fetchone()
            if not already_rejected:
                _reject_case_conn(con, preview_id, tid, actor=actor)

        record = {
            "ticket_id": tid,
            "recommended_action": recommended_action,
            "final_action": final_action,
            "decision_type": decision_type,
            "reply_text": reply_text,
            "notes": notes,
            "case_id": case_id,
            "preview_id": preview_id,
            "engine": engine,
            "actor": actor,
            "acted_at": acted_at,
        }
        con.execute(
            """INSERT INTO staff_actions (
                 ticket_id, recommended_action, final_action, decision_type,
                 reply_text, notes, case_id, preview_id, engine, actor, acted_at
               ) VALUES (
                 :ticket_id, :recommended_action, :final_action, :decision_type,
                 :reply_text, :notes, :case_id, :preview_id, :engine, :actor, :acted_at
               )
               ON CONFLICT(ticket_id) DO UPDATE SET
                 recommended_action=excluded.recommended_action,
                 final_action=excluded.final_action,
                 decision_type=excluded.decision_type,
                 reply_text=excluded.reply_text,
                 notes=excluded.notes,
                 case_id=excluded.case_id,
                 preview_id=excluded.preview_id,
                 engine=excluded.engine,
                 actor=excluded.actor,
                 acted_at=excluded.acted_at""",
            record,
        )
        con.execute(
            "INSERT INTO audit (at,ticket_id,event,inputs,result) VALUES (?,?,?,?,?)",
            (
                acted_at,
                tid,
                "staff_action",
                json.dumps(
                    {
                        "recommended_action": recommended_action,
                        "final_action": final_action,
                        "decision_type": decision_type,
                        "preview_id": preview_id,
                        "engine": engine,
                        "actor": actor,
                    }
                ),
                json.dumps(record),
            ),
        )
        return record


def list_staff_actions() -> dict[str, dict[str, Any]]:
    with connect() as con:
        rows = con.execute("SELECT * FROM staff_actions ORDER BY acted_at DESC").fetchall()
        return {r["ticket_id"]: dict(r) for r in rows}


def list_cases() -> list[dict[str, Any]]:
    with connect() as con:
        rows = con.execute("SELECT * FROM cases ORDER BY approved_at DESC").fetchall()
        return [dict(r) for r in rows]


def member_cases(member_id: str) -> list[dict[str, Any]]:
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM cases WHERE UPPER(member_id) = UPPER(?) ORDER BY approved_at DESC",
            (str(member_id).strip(),),
        ).fetchall()
        return [dict(r) for r in rows]


def get_kb_articles() -> dict[str, str]:
    kb_dir = DATA / "kb"
    if not kb_dir.exists():
        return {}
    return {
        path.stem: path.read_text(encoding="utf-8")
        for path in sorted(kb_dir.glob("*.md"))
    }


def load_tickets(data_dir: Path | None = None) -> list[dict[str, Any]]:
    """Load inbound support tickets from data/tickets.json, normalising sender email fields."""
    base = data_dir or DATA
    payload = json.loads((base / "tickets.json").read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = payload.get("tickets", [])
    normalised: list[dict[str, Any]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        sender = str(item.get("from_email") or item.get("from") or "").strip()
        item["from"] = sender
        item["from_email"] = sender
        normalised.append(item)
    return normalised


def load_results(results_path: Path | None = None) -> list[dict[str, Any]]:
    """Load persisted triage result records, returning [] when absent or invalid."""
    target = results_path or RESULTS
    if not target.exists():
        return []
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
        return [r for r in data if isinstance(r, dict) and "ticket_id" in r] if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def load_results_map(results_path: Path | None = None) -> dict[str, dict[str, Any]]:
    return {str(r["ticket_id"]): r for r in load_results(results_path)}


def save_results_map(
    by_id: dict[str, dict[str, Any]],
    ordered_tickets: list[dict[str, Any]] | None = None,
    results_path: Path | None = None,
) -> None:
    """Persist triage results deterministically in ticket order."""
    target = results_path or RESULTS
    target.parent.mkdir(parents=True, exist_ok=True)
    if ordered_tickets is not None:
        ordered_ids = [extract_ticket_id(t) for t in ordered_tickets]
        ordered = [by_id[tid] for tid in ordered_ids if tid in by_id]
        seen = set(ordered_ids)
        extras = [val for tid, val in by_id.items() if tid not in seen]
        payload = ordered + extras
    else:
        payload = list(by_id.values())
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def reset_state(results_path: Path | None = None) -> None:
    """Clear all SQLite staff_actions, cases, and audit rows and reset saved triage results."""
    with connect() as con:
        con.execute("DELETE FROM staff_actions")
        con.execute("DELETE FROM cases")
        con.execute("DELETE FROM audit")
    save_results_map({}, results_path=results_path)
