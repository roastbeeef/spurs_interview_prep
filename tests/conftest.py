"""Shared pytest test doubles so unit tests never rely on live network calls."""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import northbank.engines.jev as jev_mod

URGENCY_LEGEND: dict[int, str] = {
    0: "trivial",
    1: "low",
    2: "medium",
    3: "high",
    4: "urgent",
}

TICKET_FIXTURES: dict[str, dict[str, Any]] = {
    "T01": {
        "intent": "password_reset",
        "action": "resolve",
        "case_category": "general",
        "urgency": 2,
        "kb_grounded": 0.94,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T02": {
        "intent": "billing_dispute",
        "action": "create_case",
        "case_category": "billing_investigation",
        "urgency": 2,
        "kb_grounded": 0.86,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T03": {
        "intent": "seat_transfer",
        "action": "resolve",
        "case_category": "general",
        "urgency": 1,
        "kb_grounded": 0.91,
        "identity_confident": 0.99,
        "injection_risk": 0.03,
    },
    "T04": {
        "intent": "membership_cancellation",
        "action": "create_case",
        "case_category": "cancellation",
        "urgency": 1,
        "kb_grounded": 0.88,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T05": {
        "intent": "account_status_or_upgrade",
        "action": "ask_clarification",
        "case_category": "general",
        "urgency": 1,
        "kb_grounded": 0.12,
        "identity_confident": 0.02,
        "injection_risk": 0.03,
    },
    "T06": {
        "intent": "account_details_change",
        "action": "resolve",
        "case_category": "account_update",
        "urgency": 1,
        "kb_grounded": 0.90,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T07": {
        "intent": "account_status_or_upgrade",
        "action": "ask_clarification",
        "case_category": "general",
        "urgency": 3,
        "kb_grounded": 0.15,
        "identity_confident": 0.95,
        "injection_risk": 0.03,
    },
    "T08": {
        "intent": "junior_membership",
        "action": "resolve",
        "case_category": "general",
        "urgency": 1,
        "kb_grounded": 0.94,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T09": {
        "intent": "membership_renewal",
        "action": "create_case",
        "case_category": "reinstatement",
        "urgency": 2,
        "kb_grounded": 0.86,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T10": {
        "intent": "billing_dispute",
        "action": "escalate_to_human",
        "case_category": "general",
        "urgency": 3,
        "kb_grounded": 0.05,
        "identity_confident": 0.99,
        "injection_risk": 0.03,
    },
    "T11": {
        "intent": "loyalty_points",
        "action": "resolve",
        "case_category": "general",
        "urgency": 1,
        "kb_grounded": 0.92,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T12": {
        "intent": "untrusted_or_other",
        "action": "escalate_to_human",
        "case_category": "general",
        "urgency": 3,
        "kb_grounded": 0.18,
        "identity_confident": 0.95,
        "injection_risk": 0.99,
    },
    "T13": {
        "intent": "account_status_or_upgrade",
        "action": "escalate_to_human",
        "case_category": "general",
        "urgency": 3,
        "kb_grounded": 0.04,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
    "T14": {
        "intent": "account_details_change",
        "action": "escalate_to_human",
        "case_category": "general",
        "urgency": 3,
        "kb_grounded": 0.05,
        "identity_confident": 0.99,
        "injection_risk": 0.04,
    },
    "T15": {
        "intent": "loyalty_points",
        "action": "resolve",
        "case_category": "general",
        "urgency": 1,
        "kb_grounded": 0.78,
        "identity_confident": 0.99,
        "injection_risk": 0.02,
    },
}


class FakeTypeSafeClient:
    """Deterministic TypeSafeClient stub matching SystemOneResponse."""

    def __init__(self, api_key: str, timeout: float = 10.0) -> None:
        self.api_key = api_key
        self.timeout = timeout

    def __enter__(self) -> FakeTypeSafeClient:
        return self

    def __exit__(self, *args: Any) -> bool:
        return False

    def system_one(
        self,
        state: dict[str, Any],
        questions: dict[str, Any],
        model: str,
    ) -> SimpleNamespace:
        ticket = state.get("ticket") or {}
        tid = str(ticket.get("ticket_id", "T01"))
        spec = TICKET_FIXTURES.get(tid, TICKET_FIXTURES["T01"])
        urg = int(spec["urgency"])

        return SimpleNamespace(
            model=model,
            choices={
                "intent": SimpleNamespace(
                    choice=spec["intent"],
                    confidence=0.96,
                    probabilities={spec["intent"]: 0.96},
                ),
                "action": SimpleNamespace(
                    choice=spec["action"],
                    confidence=0.95,
                    probabilities={spec["action"]: 0.95},
                ),
                "case_category": SimpleNamespace(
                    choice=spec["case_category"],
                    confidence=0.92,
                    probabilities={spec["case_category"]: 0.92},
                ),
            },
            scores={
                "urgency": SimpleNamespace(
                    score=float(urg),
                    confidence=0.94,
                    legend=URGENCY_LEGEND,
                    probabilities={k: (0.94 if k == urg else 0.015) for k in range(5)},
                ),
            },
            nouls={
                "kb_grounded": SimpleNamespace(noul=spec["kb_grounded"]),
                "identity_confident": SimpleNamespace(noul=spec["identity_confident"]),
                "prompt_injection_risk": SimpleNamespace(noul=spec["injection_risk"]),
            },
            usage=SimpleNamespace(input_tokens=180, output_tokens=0),
        )


def _fake_draft_reply_with_haiku(
    context: Any,
    intent: str,
    action: str,
    case_preview: dict[str, Any] | None,
    **_kwargs: Any,
) -> tuple[str, list[str], str]:
    """Deterministic offline replacement for Haiku email drafting in unit tests."""
    matched = context.member_lookup.get("status") == "matched"
    member = (context.member_lookup.get("member") or {}) if matched else {}
    member_id = member.get("member_id")
    raw_first = str(member.get("first_name") or member.get("name") or "").strip()
    greeting = f"Dear {raw_first.split()[0]}," if matched and raw_first else "Dear Supporter,"
    citations = context.returned_article_ids[:1] if action in {"resolve", "create_case"} else []

    details: list[str] = []
    if matched and member.get("loyalty_points") is not None:
        details.append(f"{member.get('loyalty_points')} loyalty points")
    pending_txs = [
        str(t.get("transaction_id"))
        for t in (context.recent_transactions or {}).get("transactions", [])
        if "pending" in str(t.get("status", "")).lower() and t.get("transaction_id")
    ]
    if pending_txs:
        details.append(f"pending transaction(s): {', '.join(pending_txs)}")
    if case_preview and case_preview.get("category"):
        details.append(f"case preview ({case_preview['category']})")

    detail_suffix = f" Details: {'; '.join(details)}." if details else ""
    draft_reply = (
        f"{greeting}\n\n"
        f"Northbank FC Member Services response for {intent} ({action}).{detail_suffix}\n\n"
        "Kind regards,\nNorthbank FC Member Services"
    )
    rationale = f"Classified as {intent} -> {action}" + (f" for {member_id}." if member_id else ".")
    return draft_reply, citations, rationale


@pytest.fixture(autouse=True)
def _stub_jev_and_isolate_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use FakeTypeSafeClient and fake keys by default so unit tests stay offline."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts_test_key")
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    monkeypatch.setattr(jev_mod, "TypeSafeClient", FakeTypeSafeClient)
    monkeypatch.setattr(jev_mod, "_draft_reply_with_haiku", _fake_draft_reply_with_haiku)
