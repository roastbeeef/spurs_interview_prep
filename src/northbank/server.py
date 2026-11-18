"""FastAPI backend for the Northbank FC Member Services Triage Console."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import RESULTS
from .domain import extract_ticket_id
from .store import (
    get_kb_articles,
    list_cases,
    list_staff_actions,
    load_results_map,
    load_tickets,
    members,
    recent_audit,
    record_staff_action,
    reset_state,
    save_results_map,
    trace,
)
from .agent import compute_telemetry, run_one
from .tools import (
    check_member_case_history_impl,
    check_recent_transactions_impl,
    lookup_fixture_and_ticket_impl,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Northbank FC - Member Services Console", version="0.2.0")
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class TriageRequest(BaseModel):
    engine: Literal["jev", "claude"] = "jev"
    api_key: str | None = None


class StaffActionRequest(BaseModel):
    recommended_action: str
    final_action: str
    decision_type: Literal["accept", "reject_case", "override"] = "accept"
    reply_text: str = ""
    notes: str = ""
    preview_id: str | None = None
    engine: str = "jev"
    actor: str = "staff"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/dashboard")
def get_dashboard() -> dict[str, Any]:
    tickets = load_tickets()
    results_by_id = load_results_map(RESULTS)
    staff_actions = list_staff_actions()
    cases = list_cases()
    kb_articles = get_kb_articles()
    audit_rows = recent_audit(limit=40)
    members_by_id = {
        str(m.get("member_id", "")).strip().upper(): m
        for m in members()
        if m.get("member_id")
    }

    enriched_tickets = []
    for t in tickets:
        tid = extract_ticket_id(t)
        res = results_by_id.get(tid)
        member_info = ((res or {}).get("agent") or {}).get("member") or {}
        matched_id = (
            str(member_info.get("member_id")).strip().upper()
            if member_info.get("status") == "matched" and member_info.get("member_id")
            else None
        )
        enriched_tickets.append(
            {
                "ticket_id": tid,
                "ticket": t,
                "result": res,
                "staff_action": staff_actions.get(tid),
                "matched_member": members_by_id.get(matched_id) if matched_id else None,
                "case_history": check_member_case_history_impl(matched_id) if matched_id else None,
                "fixture_lookup": (
                    lookup_fixture_and_ticket_impl(
                        matched_id, f"{t.get('subject', '')} {t.get('body', '')}"
                    )
                    if matched_id
                    else None
                ),
                "recent_transactions": (
                    check_recent_transactions_impl(matched_id) if matched_id else None
                ),
            }
        )

    return {
        "tickets": enriched_tickets,
        "kb_articles": kb_articles,
        "cases": cases,
        "staff_actions": staff_actions,
        "recent_audit": audit_rows,
        "telemetry": compute_telemetry(tickets, results_by_id, staff_actions, cases),
    }


@app.get("/api/tickets/{ticket_id}/trace")
def get_ticket_trace(ticket_id: str) -> dict[str, Any]:
    return {"ticket_id": ticket_id, "events": trace(ticket_id)}


@app.post("/api/tickets/{ticket_id}/triage")
def triage_ticket(ticket_id: str, req: TriageRequest) -> dict[str, Any]:
    tickets = load_tickets()
    ticket = next((t for t in tickets if extract_ticket_id(t) == ticket_id), None)
    if ticket is None:
        raise HTTPException(status_code=404, detail=f"Unknown ticket_id: {ticket_id}")

    result = run_one(ticket, engine=req.engine, api_key=req.api_key)
    by_id = load_results_map(RESULTS)
    by_id[ticket_id] = result
    save_results_map(by_id, tickets, RESULTS)
    return {"result": result, "events": trace(ticket_id)}


@app.post("/api/triage-all")
def triage_all(req: TriageRequest) -> dict[str, Any]:
    tickets = load_tickets()
    by_id = load_results_map(RESULTS)
    updated = []
    # Keep tickets sequential so batch runs mirror live arrival and System-1 vs System-2 latency stays comparable.
    for ticket in tickets:
        result = run_one(ticket, engine=req.engine, api_key=req.api_key)
        by_id[result["ticket_id"]] = result
        updated.append(result)
    save_results_map(by_id, tickets, RESULTS)
    return {"count": len(updated), "engine": req.engine, "results": updated}


@app.post("/api/tickets/{ticket_id}/action")
def action_ticket(ticket_id: str, req: StaffActionRequest) -> dict[str, Any]:
    tickets = load_tickets()
    if not any(extract_ticket_id(t) == ticket_id for t in tickets):
        raise HTTPException(status_code=404, detail=f"Unknown ticket_id: {ticket_id}")
    try:
        saved = record_staff_action(
            ticket_id=ticket_id,
            recommended_action=req.recommended_action,
            final_action=req.final_action,
            decision_type=req.decision_type,
            reply_text=req.reply_text,
            notes=req.notes,
            preview_id=req.preview_id,
            engine=req.engine,
            actor=req.actor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "staff_action": saved,
        "events": trace(ticket_id),
        "cases": list_cases(),
    }


@app.post("/api/reset")
def reset_console() -> dict[str, Any]:
    reset_state(RESULTS)
    return get_dashboard()


def main() -> None:
    uvicorn.run("northbank.server:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
