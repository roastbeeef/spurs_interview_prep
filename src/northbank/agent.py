"""Triage orchestration and telemetry aggregation."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import contextvars
import json
from typing import Any

from .config import RESULTS, get_claude_api_key, get_typesafe_api_key
from .domain import (
    ACTION_CRITERIA,
    ALLOWED_ACTIONS,
    CATEGORY_CRITERIA,
    INTENT_CRITERIA,
    URGENCY_CRITERIA,
    GroundedContext,
    extract_member_id,
    extract_ticket_id,
    normalise_error_result,
)
from .engines import create_engine
from .engines.claude import SYSTEM, parse_json
from .mcp_server import (
    check_member_case_history,
    check_recent_transactions,
    lookup_fixture_and_ticket,
    lookup_member,
    search_kb,
)
from .store import eval_audit_rows, list_staff_actions, load_tickets, ticket_context


def _recent_staff_feedback(limit: int = 5) -> list[dict[str, Any]]:
    """Return recent staff overrides/rejections so both engines see a live human feedback loop."""
    feedback: list[dict[str, Any]] = []
    for action in list_staff_actions().values():
        if action.get("decision_type") not in {"override", "reject_case"}:
            continue
        feedback.append(
            {
                "ticket_id": action.get("ticket_id"),
                "recommended_action": action.get("recommended_action"),
                "final_action": action.get("final_action"),
                "decision_type": action.get("decision_type"),
                "notes": action.get("notes") or "",
                "engine": action.get("engine"),
                "acted_at": action.get("acted_at"),
            }
        )
        if len(feedback) >= limit:
            break
    return feedback


def _extract_sender_email(ticket: dict[str, Any]) -> str:
    return str(ticket.get("from_email") or ticket.get("from") or "").strip()


def build_initial_context(ticket: dict[str, Any]) -> GroundedContext:
    """Construct raw ticket context without pre-calling MCP tools (for autonomous System-2 tool use)."""
    tid = extract_ticket_id(ticket)
    sender_email = _extract_sender_email(ticket)
    subject = str(ticket.get("subject", "")).strip()
    body = str(ticket.get("body", "")).strip()
    combined_text = f"{subject} {body}"
    return GroundedContext(
        ticket_id=tid,
        ticket=ticket,
        sender_email=sender_email,
        subject=subject,
        body=body,
        extracted_member_id=extract_member_id(combined_text),
        member_lookup={},
        kb_search={},
        returned_article_ids=[],
        staff_feedback=_recent_staff_feedback(),
    )


def hydrate_grounded_context(context: GroundedContext) -> GroundedContext:
    """Populate MCP-grounded lookup, KB, and member-scoped fields on an initial GroundedContext."""
    combined_text = f"{context.subject} {context.body}".strip()
    with ThreadPoolExecutor(max_workers=2) as executor:
        member_fut = executor.submit(
            contextvars.copy_context().run,
            lookup_member,
            email=context.sender_email,
            member_id=context.extracted_member_id,
        )
        kb_fut = executor.submit(
            contextvars.copy_context().run,
            search_kb,
            query=combined_text,
            limit=3,
        )
        member_res = member_fut.result()
        kb_res = kb_fut.result()
    returned_article_ids = [a["article_id"] for a in kb_res.get("articles", [])]

    matched_member_id = (
        str(member_res.get("member", {}).get("member_id", "")).strip()
        if member_res.get("status") == "matched"
        else ""
    )
    if matched_member_id:
        with ThreadPoolExecutor(max_workers=3) as executor:
            case_fut = executor.submit(
                contextvars.copy_context().run,
                check_member_case_history,
                member_id=matched_member_id,
            )
            fixture_fut = executor.submit(
                contextvars.copy_context().run,
                lookup_fixture_and_ticket,
                member_id=matched_member_id,
                fixture_query=combined_text,
            )
            tx_fut = executor.submit(
                contextvars.copy_context().run,
                check_recent_transactions,
                member_id=matched_member_id,
            )
            case_history = case_fut.result()
            fixture_lookup = fixture_fut.result()
            recent_transactions = tx_fut.result()
    else:
        case_history = {}
        fixture_lookup = {}
        recent_transactions = {}

    return GroundedContext(
        ticket_id=context.ticket_id,
        ticket=context.ticket,
        sender_email=context.sender_email,
        subject=context.subject,
        body=context.body,
        extracted_member_id=context.extracted_member_id,
        member_lookup=member_res,
        kb_search=kb_res,
        returned_article_ids=returned_article_ids,
        staff_feedback=context.staff_feedback,
        case_history=case_history,
        fixture_lookup=fixture_lookup,
        recent_transactions=recent_transactions,
    )


def gather_context(ticket: dict[str, Any]) -> GroundedContext:
    """Fetch read-only member identity, KB grounding, tool context, and recent staff feedback."""
    return hydrate_grounded_context(build_initial_context(ticket))


def run_one(ticket: dict[str, Any], engine: str = "jev", api_key: str | None = None) -> dict[str, Any]:
    """Run triage for one ticket with automatic fallback between jev and claude."""
    tid = extract_ticket_id(ticket)
    selected = (engine or "jev").strip().lower()
    if selected == "jev" and not get_typesafe_api_key(api_key) and get_claude_api_key():
        selected = "claude"
        api_key = None
    try:
        primary_engine = create_engine(selected, api_key=api_key)
        with ticket_context(tid):
            context = build_initial_context(ticket) if selected == "claude" else gather_context(ticket)
            primary_res = primary_engine.recommend(context)
            if not primary_res.get("error"):
                return primary_res

            fallback_name = "claude" if selected == "jev" else "jev"
            fallback_context = (
                hydrate_grounded_context(context) if fallback_name == "jev" and not context.member_lookup else context
            )
            fallback_res = create_engine(fallback_name).recommend(fallback_context)
            if not fallback_res.get("error") and isinstance(fallback_res.get("agent"), dict):
                uncertainty = fallback_res["agent"].setdefault("uncertainty", [])
                if "provider_fallback" not in uncertainty:
                    uncertainty.append("provider_fallback")
                return fallback_res

            return normalise_error_result(
                ticket_id=tid,
                ticket=ticket,
                engine=selected,
                provider=primary_res.get("provider"),
                error=(
                    f"Primary ({selected}) failed: {primary_res.get('error')}; "
                    f"fallback ({fallback_name}) failed: {fallback_res.get('error')}"
                ),
            )
    except Exception as exc:
        return normalise_error_result(
            ticket_id=tid,
            ticket=ticket,
            engine=selected,
            error=str(exc),
        )


def run_one_jev(ticket: dict[str, Any], api_key: str | None = None) -> dict[str, Any]:
    return run_one(ticket, engine="jev", api_key=api_key)


def run_one_claude(ticket: dict[str, Any], api_key: str | None = None) -> dict[str, Any]:
    return run_one(ticket, engine="claude", api_key=api_key)


def _load_audit_latency_history() -> tuple[list[float], list[float], list[dict[str, Any]]]:
    """Read historical Jev and Claude evaluation latencies from SQLite audit in order."""
    jev_latencies: list[float] = []
    claude_latencies: list[float] = []
    history: list[dict[str, Any]] = []

    for row in eval_audit_rows():
        try:
            inp_obj = json.loads(row["inputs"]) if row["inputs"] else {}
            res_obj = json.loads(row["result"]) if row["result"] else {}
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(inp_obj, dict) or not isinstance(res_obj, dict):
            continue

        lat = res_obj.get("latency_ms")
        if not isinstance(lat, (int, float)) or lat <= 0:
            continue

        engine = "jev" if row["event"] == "jev_system_one_eval" else "claude"
        latency_ms = round(float(lat), 2)
        if engine == "jev":
            jev_latencies.append(latency_ms)
            engine_lats = jev_latencies
            default_model = "jev-latest"
        else:
            claude_latencies.append(latency_ms)
            engine_lats = claude_latencies
            default_model = "claude"

        model = res_obj.get("model") or inp_obj.get("model") or default_model
        running_avg_ms = round(sum(engine_lats) / len(engine_lats), 2)
        history.append(
            {
                "id": int(row["id"]),
                "at": str(row["at"]),
                "ticket_id": str(row["ticket_id"] or ""),
                "engine": engine,
                "model": str(model),
                "run_index": len(engine_lats),
                "latency_ms": latency_ms,
                "running_avg_ms": running_avg_ms,
            }
        )

    return jev_latencies, claude_latencies, history


def compute_telemetry(
    tickets: list[dict[str, Any]],
    results_by_id: dict[str, dict[str, Any]],
    staff_actions: dict[str, dict[str, Any]],
    cases: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate queue completion, engine latencies, confidence, and human agreement."""
    by_action = {"resolve": 0, "create_case": 0, "escalate_to_human": 0, "ask_clarification": 0}
    by_intent: dict[str, int] = {}
    by_engine = {"jev": 0, "claude": 0}
    jev_latencies: list[float] = []
    jev_confidences: list[float] = []
    claude_latencies: list[float] = []
    triaged_count = 0

    for t in tickets:
        tid = extract_ticket_id(t)
        r = results_by_id.get(tid)
        if not r or not r.get("agent"):
            continue
        triaged_count += 1
        agent = r["agent"]
        act = agent.get("action")
        if act in by_action:
            by_action[act] += 1
        intent = agent.get("intent") or "unknown"
        by_intent[intent] = by_intent.get(intent, 0) + 1

        eng = r.get("engine", "jev")
        if eng in by_engine:
            by_engine[eng] += 1

        lat = r.get("latency_ms")
        if eng == "jev":
            if isinstance(lat, (int, float)):
                jev_latencies.append(float(lat))
            conf = agent.get("confidence")
            if isinstance(conf, (int, float)):
                jev_confidences.append(float(conf))
        elif eng == "claude" and isinstance(lat, (int, float)):
            claude_latencies.append(float(lat))

    audit_jev_latencies, audit_claude_latencies, latency_history = _load_audit_latency_history()
    effective_jev_latencies = audit_jev_latencies if audit_jev_latencies else jev_latencies
    effective_claude_latencies = audit_claude_latencies if audit_claude_latencies else claude_latencies

    acted_values = list(staff_actions.values())
    agreements = sum(1 for a in acted_values if a.get("decision_type") == "accept")
    agreement_rate = round(agreements / len(acted_values), 4) if acted_values else None

    return {
        "total_tickets": len(tickets),
        "triaged_count": triaged_count,
        "actioned_count": len(staff_actions),
        "pending_count": max(0, len(tickets) - len(staff_actions)),
        "approved_cases_count": len(cases),
        "by_action": by_action,
        "by_intent": by_intent,
        "by_engine": by_engine,
        "jev_avg_latency_ms": (
            round(sum(effective_jev_latencies) / len(effective_jev_latencies), 2)
            if effective_jev_latencies
            else None
        ),
        "jev_run_count": len(effective_jev_latencies),
        "jev_avg_confidence": round(sum(jev_confidences) / len(jev_confidences), 4) if jev_confidences else None,
        "claude_avg_latency_ms": (
            round(sum(effective_claude_latencies) / len(effective_claude_latencies), 2)
            if effective_claude_latencies
            else None
        ),
        "claude_run_count": len(effective_claude_latencies),
        "latency_history": latency_history[-30:],
        "human_model_agreement_rate": agreement_rate,
        "flywheel_labelled_count": len(staff_actions),
        "typesafe_api_key_configured": bool(get_typesafe_api_key()),
        "claude_api_key_configured": bool(get_claude_api_key()),
    }


__all__ = [
    "ACTION_CRITERIA",
    "ALLOWED_ACTIONS",
    "CATEGORY_CRITERIA",
    "INTENT_CRITERIA",
    "RESULTS",
    "SYSTEM",
    "URGENCY_CRITERIA",
    "build_initial_context",
    "compute_telemetry",
    "gather_context",
    "hydrate_grounded_context",
    "load_tickets",
    "parse_json",
    "run_one",
    "run_one_claude",
    "run_one_jev",
]
