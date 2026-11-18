"""Architecture, contract parity, safety guardrail, and transactional integrity tests."""
from __future__ import annotations

import csv
import json
import threading
from unittest.mock import MagicMock

import httpx
import pytest
from typesafe_sdk import TypeSafeError

import northbank.config as cfg
import northbank.engines.claude as claude_mod
import northbank.engines.jev as jev_mod
import northbank.evaluate as eval_mod

_REAL_JEV_DRAFT_REPLY = jev_mod._draft_reply_with_haiku
import northbank.store as store
from northbank.agent import URGENCY_CRITERIA, gather_context, run_one
from northbank.engines import ClaudeEngine, JevEngine, create_engine
from northbank.mcp_server import dispatch_tool
from northbank.store import (
    approve_case,
    audit,
    list_cases,
    list_staff_actions,
    load_tickets,
    record_staff_action,
    reject_case,
    ticket_context,
    trace,
)
from northbank.tools import create_case_impl, lookup_member_impl

EXPECTED_TOP_KEYS = {
    "ticket_id",
    "ticket",
    "engine",
    "model",
    "provider",
    "latency_ms",
    "usage",
    "turns",
    "agent",
    "system_one",
    "error",
}

EXPECTED_AGENT_KEYS = {
    "intent",
    "member",
    "action",
    "draft_reply",
    "citations",
    "rationale",
    "case_preview",
    "confidence",
    "uncertainty",
    "requires_staff_review",
}


def _make_fake_anthropic_response(content_blocks: list[dict], input_tokens: int = 100, output_tokens: int = 50):
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "content": content_blocks,
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
    }
    return resp


def test_engine_contract_parity_jev_and_claude(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "parity.sqlite3")

    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t1 = tickets["T01"]

    # 0. Engine factory returns interchangeable engines and rejects unknown names
    jev_eng = create_engine("jev", api_key="ts_key")
    claude_eng = create_engine("claude", api_key="sk_key")
    assert isinstance(jev_eng, JevEngine)
    assert isinstance(claude_eng, ClaudeEngine)
    assert jev_eng.name == "jev"
    assert claude_eng.name == "claude"
    with pytest.raises(ValueError, match="Unsupported triage engine"):
        create_engine("other_model")

    # 1. Urgency criteria form a 5-level discrete ordinal scale (0: trivial .. 4: urgent)
    assert URGENCY_CRITERIA == ["trivial", "low", "medium", "high", "urgent"]

    # 2. Jev live API contract (via conftest FakeTypeSafeClient)
    jev_api = run_one(t1, engine="jev", api_key="ts_test_key")
    assert set(jev_api.keys()) == EXPECTED_TOP_KEYS
    assert set(jev_api["agent"].keys()) == EXPECTED_AGENT_KEYS
    assert jev_api["error"] is None
    assert jev_api["engine"] == "jev"
    assert jev_api["provider"] == "typesafe-api"
    assert jev_api["agent"]["action"] == "resolve"
    assert jev_api["agent"]["requires_staff_review"] is False
    urg_api = jev_api["system_one"]["scores"]["urgency"]
    assert isinstance(urg_api["score"], int)
    assert 0 <= urg_api["score"] <= 4
    assert urg_api["label"] == URGENCY_CRITERIA[urg_api["score"]]

    # 3. Claude Messages API (mocked httpx.Client with autonomous MCP tool calls)
    claude_json = json.dumps(
        {
            "intent": "password_reset",
            "member": {"status": "matched", "member_id": "NB100101", "reason": ""},
            "action": "resolve",
            "draft_reply": "Hi Daniel, use Forgot password on the login page.",
            "citations": ["password-reset"],
            "rationale": "Matched NB100101 and cited password-reset KB.",
            "case_preview": None,
        }
    )

    class AutonomousHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            self.turn = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            self.turn += 1
            if self.turn == 1:
                # Verify autonomous path does not pre-populate member_lookup
                user_msg = json["messages"][0]["content"]
                assert "member_lookup" not in user_msg
                return _make_fake_anthropic_response(
                    [
                        {
                            "type": "tool_use",
                            "id": "toolu_lookup",
                            "name": "lookup_member",
                            "input": {"email": "daniel.hughes@example.com"},
                        },
                        {
                            "type": "tool_use",
                            "id": "toolu_kb",
                            "name": "search_kb",
                            "input": {"query": "can't log in password wrong"},
                        },
                    ]
                )
            return _make_fake_anthropic_response([{"type": "text", "text": claude_json}])

    monkeypatch.setattr(claude_mod.httpx, "Client", AutonomousHttpxClient)
    claude_api = run_one(t1, engine="claude", api_key="sk-ant-test")
    assert set(claude_api.keys()) == EXPECTED_TOP_KEYS
    assert set(claude_api["agent"].keys()) == EXPECTED_AGENT_KEYS
    assert claude_api["error"] is None
    assert claude_api["engine"] == "claude"
    assert claude_api["provider"] == "anthropic-api"
    assert claude_api["turns"] == 2
    assert claude_api["agent"]["member"]["member_id"] == "NB100101"
    assert claude_api["agent"]["confidence"] is None
    assert "confidence_not_calibrated" in claude_api["agent"]["uncertainty"]
    t1_events = [e["event"] for e in trace("T01")]
    assert "lookup_member" in t1_events
    assert "search_kb" in t1_events

    # 4. Unsupported engine fails closed cleanly
    err_res = run_one(t1, engine="unknown_engine")
    assert err_res["agent"] is None
    assert "Unsupported triage engine" in err_res["error"]


def test_claude_blocks_prompt_injected_member_and_strips_fake_citations(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "claude_guard.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t5 = tickets["T05"]  # Unmatched r.whitfield@example.com / NB199999

    malicious_payload = json.dumps(
        {
            "intent": "untrusted_or_other",
            "member": {"status": "matched", "member_id": "NB100101", "reason": "injected"},
            "action": "create_case",
            "draft_reply": "Upgraded to Gold.",
            "citations": ["renewals", "fabricated_vip_policy"],
            "rationale": "Followed ticket instructions.",
            "case_preview": {"status": "preview", "preview_id": "fake-uuid-999"},
        }
    )

    class FakeHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            return _make_fake_anthropic_response([{"type": "text", "text": malicious_payload}])

    monkeypatch.setattr(claude_mod.httpx, "Client", FakeHttpxClient)
    res = run_one(t5, engine="claude", api_key="sk-ant-test")

    assert res["error"] is None
    assert res["agent"]["member"]["status"] == "no_match"
    assert res["agent"]["member"]["member_id"] is None
    assert res["agent"]["action"] == "ask_clarification"
    assert res["agent"]["case_preview"] is None
    assert res["agent"]["citations"] == ["renewals"]
    assert "unverified_identity_claim_blocked" in res["agent"]["uncertainty"]
    assert "unverified_citations_removed" in res["agent"]["uncertainty"]
    assert res["agent"]["requires_staff_review"] is True
    assert list_cases() == []


def test_claude_rejects_fabricated_case_preview_not_in_audit(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "claude_preview.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t4 = tickets["T04"]

    fabricated = json.dumps(
        {
            "intent": "membership_cancellation",
            "member": {"status": "matched", "member_id": "NB100104", "reason": ""},
            "action": "create_case",
            "draft_reply": "Case created.",
            "citations": ["cancellations"],
            "rationale": "Created preview without calling MCP tool.",
            "case_preview": {
                "status": "preview",
                "preview_id": "fabricated-uuid-not-audited",
                "member_id": "NB100104",
                "category": "cancellation",
                "summary": "Cancel membership",
            },
        }
    )

    class FakeHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            return _make_fake_anthropic_response([{"type": "text", "text": fabricated}])

    monkeypatch.setattr(claude_mod.httpx, "Client", FakeHttpxClient)
    with ticket_context("T04"):
        ctx = gather_context(t4)
    direct_res = create_engine("claude", api_key="sk-ant-test").recommend(ctx)
    assert direct_res["agent"] is None
    assert "missing valid audited preview" in direct_res["error"]

    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    res = run_one(t4, engine="claude", api_key="sk-ant-test")
    assert res["agent"] is None
    assert "missing valid audited preview" in res["error"]
    assert list_cases() == []


def test_claude_tool_loop_create_case_audited_and_api_failures(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "claude_tools.sqlite3")
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t4 = tickets["T04"]

    class TwoTurnHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            self.turn = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            self.turn += 1
            if self.turn == 1:
                user_msg = json["messages"][0]["content"]
                assert "ticket" in user_msg
                assert "staff_feedback" in user_msg
                return _make_fake_anthropic_response(
                    [
                        {
                            "type": "tool_use",
                            "id": "toolu_1",
                            "name": "create_case",
                            "input": {
                                "member_id": "NB100104",
                                "category": "cancellation",
                                "summary": "Member requested end-of-season cancellation.",
                            },
                        }
                    ]
                )
            last_msg = json["messages"][-1]["content"][0]["content"]
            final = {
                "intent": "membership_cancellation",
                "member": {"status": "matched", "member_id": "NB100104", "reason": ""},
                "action": "create_case",
                "draft_reply": "Hi Sarah, cancellation case queued for staff confirmation.",
                "citations": ["cancellations"],
                "rationale": "Audited preview generated via MCP create_case.",
                "case_preview": __import__("json").loads(last_msg),
            }
            return _make_fake_anthropic_response([{"type": "text", "text": __import__("json").dumps(final)}])

    monkeypatch.setattr(claude_mod.httpx, "Client", TwoTurnHttpxClient)
    res = run_one(t4, engine="claude", api_key="sk-ant-test")
    assert res["error"] is None
    assert res["agent"]["action"] == "create_case"
    assert res["agent"]["case_preview"]["status"] == "preview"
    assert res["turns"] == 2
    assert list_cases() == []

    # Missing CLAUDE_API_KEY fails closed directly on ClaudeEngine
    with ticket_context("T_CLAUDE_NOKEY"):
        ctx2 = gather_context(t4)
    missing_key_res = create_engine("claude").recommend(ctx2)
    assert missing_key_res["agent"] is None
    assert missing_key_res["provider"] == "anthropic-api"
    assert "CLAUDE_API_KEY is not configured" in missing_key_res["error"]

    # Anthropic HTTP error fails closed on ClaudeEngine
    class FailingHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            err_resp = MagicMock()
            err_resp.status_code = 500
            err_resp.text = "upstream overloaded"
            return err_resp

    monkeypatch.setattr(claude_mod.httpx, "Client", FailingHttpxClient)
    api_err_res = create_engine("claude", api_key="sk-ant-test").recommend(ctx2)
    assert api_err_res["agent"] is None
    assert api_err_res["provider"] == "anthropic-api"
    assert "Anthropic API error 500" in api_err_res["error"]
    assert list_cases() == []


def test_staff_feedback_loop_in_context(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "feedback_loop.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}

    record_staff_action(
        ticket_id="T01",
        recommended_action="resolve",
        final_action="escalate_to_human",
        decision_type="override",
        notes="Thumbs-down feedback test",
        engine="jev",
    )

    with ticket_context("T_FEEDBACK"):
        ctx = gather_context(tickets["T04"])
    assert len(ctx.staff_feedback) == 1
    assert ctx.staff_feedback[0]["ticket_id"] == "T01"
    assert ctx.staff_feedback[0]["final_action"] == "escalate_to_human"
    assert "cancellations" in ctx.returned_article_ids


def test_cross_engine_fallback_jev_and_claude_and_both_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "cross_fallback.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t1 = tickets["T01"]

    claude_json = json.dumps(
        {
            "intent": "password_reset",
            "member": {"status": "matched", "member_id": "NB100101", "reason": ""},
            "action": "resolve",
            "draft_reply": "Hi Daniel, use Forgot password.",
            "citations": ["password-reset"],
            "rationale": "Fallback to Claude after Jev outage.",
            "case_preview": None,
        }
    )

    class OkHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            return _make_fake_anthropic_response([{"type": "text", "text": claude_json}])

    class FailingTypeSafeClient:
        def __init__(self, api_key: str, timeout: float = 10.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def system_one(self, state, questions, model):
            raise TypeSafeError("upstream 503")

    # 1. Jev fails -> falls back automatically to Claude
    monkeypatch.setattr(claude_mod.httpx, "Client", OkHttpxClient)
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-ant-fallback")

    with monkeypatch.context() as m:
        m.setattr(jev_mod, "TypeSafeClient", FailingTypeSafeClient)
        jev_to_claude = run_one(t1, engine="jev", api_key="ts_test_key")
    assert jev_to_claude["error"] is None
    assert jev_to_claude["engine"] == "claude"
    assert jev_to_claude["agent"]["action"] == "resolve"
    assert "provider_fallback" in jev_to_claude["agent"]["uncertainty"]

    # 2. Claude fails -> falls back automatically to Jev (hydrates grounded context lazily)
    class FailingHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            raise httpx.ConnectError("anthropic unreachable")

    monkeypatch.setattr(claude_mod.httpx, "Client", FailingHttpxClient)

    claude_to_jev = run_one(t1, engine="claude", api_key="sk-ant-test")
    assert claude_to_jev["error"] is None
    assert claude_to_jev["engine"] == "jev"
    assert claude_to_jev["agent"]["action"] == "resolve"
    assert "provider_fallback" in claude_to_jev["agent"]["uncertainty"]

    # 3. Both unavailable -> untagged error result (agent=None, system_one=None)
    monkeypatch.setattr(jev_mod, "TypeSafeClient", FailingTypeSafeClient)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    both_down = run_one(t1, engine="jev", api_key="ts_test_key")
    assert both_down["agent"] is None
    assert both_down["system_one"] is None
    assert "Primary (jev) failed" in both_down["error"]
    assert "fallback (claude) failed" in both_down["error"]

    # 4. Missing TYPESAFE_API_KEY with CLAUDE_API_KEY set -> routes default engine="jev" directly to Claude
    captured_msgs: list[str] = []

    class DirectClaudeHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            captured_msgs.append(json["messages"][0]["content"])
            return _make_fake_anthropic_response([{"type": "text", "text": claude_json}])

    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-ant-only")
    monkeypatch.setattr(claude_mod.httpx, "Client", DirectClaudeHttpxClient)

    routed = run_one(t1, engine="jev")
    assert routed["error"] is None
    assert routed["engine"] == "claude"
    assert routed["agent"]["action"] == "resolve"
    assert "provider_fallback" not in routed["agent"]["uncertainty"]
    assert "member_lookup" not in captured_msgs[0]


def test_mcp_tool_validation_and_ambiguity(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "mcp_tools.sqlite3")

    assert create_case_impl("NB100101", "vip_upgrade", "free box")["status"] == "refused"
    assert create_case_impl("NB100101", "", "summary")["status"] == "refused"
    assert create_case_impl("NB100101", "cancellation", "   ")["status"] == "refused"
    assert create_case_impl("UNKNOWN", "cancellation", "cancel")["status"] == "refused"

    conflict = lookup_member_impl(email="daniel.hughes@example.com", member_id="NB100102")
    assert conflict["status"] == "no_match"
    assert conflict["ambiguous"] is True

    unknown = lookup_member_impl(email="nobody@example.com")
    assert unknown["status"] == "no_match"
    assert unknown["ambiguous"] is False

    with ticket_context("T_DISPATCH"):
        preview = dispatch_tool(
            "create_case",
            {"member_id": "NB100104", "category": "cancellation", "summary": "Cancel membership"},
        )
        case_hist = dispatch_tool("check_member_case_history", {"member_id": "NB100105"})
        fixture_res = dispatch_tool("lookup_fixture_and_ticket", {"member_id": "NB100103", "fixture_query": "Westbridge"})
        tx_res = dispatch_tool("check_recent_transactions", {"member_id": "NB100102"})
    assert preview["status"] == "preview"
    assert case_hist["status"] == "matched"
    assert fixture_res["tickets"][0]["exchange_eligible"] is True
    assert tx_res["has_duplicate_pending"] is True
    assert list_cases() == []
    events_dispatch = {ev["event"] for ev in trace("T_DISPATCH")}
    assert {
        "create_case",
        "check_member_case_history",
        "lookup_fixture_and_ticket",
        "check_recent_transactions",
    }.issubset(events_dispatch)


def test_new_tools_uncertainty_flags_and_unmatched_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "new_tools_guard.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}

    # Matched T02 triggers duplicate_pending_charge_detected and grounds TXN IDs
    r2 = run_one(tickets["T02"], engine="jev")
    assert "duplicate_pending_charge_detected" in r2["agent"]["uncertainty"]
    assert "TXN-9202" in r2["agent"]["draft_reply"]

    # Unmatched T05 never invokes member-scoped context tools
    with ticket_context("T05"):
        ctx5 = gather_context(tickets["T05"])
    assert ctx5.case_history == {}
    assert ctx5.fixture_lookup == {}
    assert ctx5.recent_transactions == {}
    t5_events = {ev["event"] for ev in trace("T05")}
    assert "check_member_case_history" not in t5_events
    assert "lookup_fixture_and_ticket" not in t5_events
    assert "check_recent_transactions" not in t5_events

    # Claude post-validation also propagates duplicate_pending_charge_detected for NB100102
    captured_payload: dict[str, object] = {}
    claude_json = json.dumps(
        {
            "intent": "billing_dispute",
            "member": {"status": "matched", "member_id": "NB100102", "reason": ""},
            "action": "escalate_to_human",
            "draft_reply": "Hi Priya, escalating your duplicate pending charge.",
            "citations": ["renewals"],
            "rationale": "Detected duplicate pending hold TXN-9202.",
            "case_preview": None,
        }
    )

    class InspectingHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            captured_payload["user_msg"] = json["messages"][0]["content"]
            return _make_fake_anthropic_response([{"type": "text", "text": claude_json}])

    monkeypatch.setattr(claude_mod.httpx, "Client", InspectingHttpxClient)
    r2_claude = run_one(tickets["T02"], engine="claude", api_key="sk-ant-test")
    assert r2_claude["error"] is None
    assert "duplicate_pending_charge_detected" in r2_claude["agent"]["uncertainty"]
    assert "T02" in str(captured_payload["user_msg"])


def test_approval_fail_closed_and_rejection_invariants(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "approvals.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}

    # Missing preview_id must fail closed before writing cases or staff_actions
    with pytest.raises(ValueError, match="preview_id"):
        record_staff_action(
            ticket_id="T04",
            recommended_action="create_case",
            final_action="create_case",
            decision_type="accept",
            preview_id=None,
        )
    assert list_cases() == []
    assert list_staff_actions() == {}

    # Invalid decision_type / final_action rejected
    with pytest.raises(ValueError, match="decision_type"):
        record_staff_action("T04", "resolve", "resolve", decision_type="auto_approve")
    with pytest.raises(ValueError, match="final_action"):
        record_staff_action("T04", "resolve", "drop_database", decision_type="override")

    # Rejected proposal cannot subsequently be approved
    r4 = run_one(tickets["T04"], engine="jev")
    pid4 = r4["agent"]["case_preview"]["preview_id"]
    record_staff_action(
        ticket_id="T04",
        recommended_action="create_case",
        final_action="rejected",
        decision_type="reject_case",
        preview_id=pid4,
        engine="jev",
    )
    with pytest.raises(ValueError, match="rejected"):
        approve_case(pid4, "T04")
    assert list_cases() == []

    # Approved proposal cannot subsequently be rejected
    r9 = run_one(tickets["T09"], engine="jev")
    pid9 = r9["agent"]["case_preview"]["preview_id"]
    record_staff_action(
        ticket_id="T09",
        recommended_action="create_case",
        final_action="create_case",
        decision_type="accept",
        preview_id=pid9,
        engine="jev",
    )
    assert len(list_cases()) == 1
    with pytest.raises(ValueError, match="Already approved"):
        reject_case(pid9, "T09")


def test_ticket_context_concurrent_thread_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "concurrent.sqlite3")
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def worker(tid: str) -> None:
        try:
            with ticket_context(tid):
                barrier.wait(timeout=3)
                audit("thread_probe", {"tid": tid}, {"ok": True})
        except BaseException as exc:
            errors.append(exc)

    t_a = threading.Thread(target=worker, args=("T_ALPHA",))
    t_b = threading.Thread(target=worker, args=("T_BETA",))
    t_a.start()
    t_b.start()
    t_a.join(timeout=5)
    t_b.join(timeout=5)

    assert not errors
    alpha_events = trace("T_ALPHA")
    beta_events = trace("T_BETA")
    assert len(alpha_events) == 1
    assert json.loads(alpha_events[0]["inputs"]) == {"tid": "T_ALPHA"}
    assert len(beta_events) == 1
    assert json.loads(beta_events[0]["inputs"]) == {"tid": "T_BETA"}


def test_evaluate_end_to_end(tmp_path, monkeypatch):
    out_dir = tmp_path / "out"
    results_path = out_dir / "results.json"
    db_path = out_dir / "northbank.sqlite3"

    monkeypatch.setattr(store, "DB", db_path)
    monkeypatch.setattr(cfg, "OUTPUT", out_dir)
    monkeypatch.setattr(cfg, "RESULTS", results_path)
    monkeypatch.setattr(eval_mod, "OUTPUT", out_dir)
    monkeypatch.setattr(eval_mod, "RESULTS", results_path)

    tickets = load_tickets()
    t1 = next(t for t in tickets if t["ticket_id"] == "T01")
    res = run_one(t1, engine="jev")
    store.save_results_map({"T01": res}, tickets, results_path)

    assert results_path.exists()
    saved = json.loads(results_path.read_text(encoding="utf-8"))
    assert [r["ticket_id"] for r in saved] == ["T01"]
    assert saved[0]["agent"]["action"] == "resolve"

    eval_mod.main()
    eval_csv = out_dir / "evaluation.csv"
    assert eval_csv.exists()
    with eval_csv.open(newline="", encoding="utf-8") as f:
        rows = {r["ticket_id"]: r for r in csv.DictReader(f)}
    assert rows["T01"]["expected_action"] == "resolve"
    assert rows["T01"]["actual_action"] == "resolve"
    assert rows["T01"]["correct"] == "True"


def test_claude_parallel_tool_dispatch_preserves_order_and_audit_ticket_id(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "claude_parallel.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t2 = tickets["T02"]

    barrier = threading.Barrier(3)
    orig_dispatch = claude_mod.dispatch_tool

    def synchronised_dispatch(name: str, tool_input: dict):
        barrier.wait(timeout=3)
        return orig_dispatch(name, tool_input)

    monkeypatch.setattr(claude_mod, "dispatch_tool", synchronised_dispatch)

    captured_tool_results: list[dict] = []

    class ParallelToolHttpxClient:
        def __init__(self, timeout: float = 45.0) -> None:
            self.turn = 0

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            self.turn += 1
            if self.turn == 1:
                return _make_fake_anthropic_response(
                    [
                        {
                            "type": "tool_use",
                            "id": "toolu_lookup",
                            "name": "lookup_member",
                            "input": {"email": "priya.shah@example.com"},
                        },
                        {
                            "type": "tool_use",
                            "id": "toolu_kb",
                            "name": "search_kb",
                            "input": {"query": "duplicate renewal charge"},
                        },
                        {
                            "type": "tool_use",
                            "id": "toolu_tx",
                            "name": "check_recent_transactions",
                            "input": {"member_id": "NB100102"},
                        },
                    ]
                )
            captured_tool_results.extend(json["messages"][-1]["content"])
            final_json = __import__("json").dumps(
                {
                    "intent": "billing_dispute",
                    "member": {"status": "matched", "member_id": "NB100102", "reason": ""},
                    "action": "escalate_to_human",
                    "draft_reply": "Hi Priya, escalating your duplicate pending charge.",
                    "citations": ["renewals"],
                    "rationale": "Verified member, KB, and duplicate pending transaction.",
                    "case_preview": None,
                }
            )
            return _make_fake_anthropic_response([{"type": "text", "text": final_json}])

    monkeypatch.setattr(claude_mod.httpx, "Client", ParallelToolHttpxClient)
    res = run_one(t2, engine="claude", api_key="sk-ant-test")

    assert res["error"] is None
    assert res["model"] == cfg.CLAUDE_MODEL
    assert [item["tool_use_id"] for item in captured_tool_results] == [
        "toolu_lookup",
        "toolu_kb",
        "toolu_tx",
    ]
    assert json.loads(captured_tool_results[0]["content"])["status"] == "matched"
    assert "articles" in json.loads(captured_tool_results[1]["content"])
    assert json.loads(captured_tool_results[2]["content"])["has_duplicate_pending"] is True

    events_t2 = [ev["event"] for ev in trace("T02")]
    assert {"lookup_member", "search_kb", "check_recent_transactions", "claude_system_two_eval"}.issubset(
        set(events_t2)
    )


def test_jev_uses_haiku_to_draft_email_and_filters_citations(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "jev_haiku_draft.sqlite3")
    monkeypatch.setattr(jev_mod, "_draft_reply_with_haiku", _REAL_JEV_DRAFT_REPLY)
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-ant-draft-test")

    tickets = {t["ticket_id"]: t for t in load_tickets()}
    t1 = tickets["T01"]

    captured: dict[str, object] = {}
    haiku_draft_json = json.dumps(
        {
            "draft_reply": (
                "Dear Daniel,\n\n"
                "Please click Forgot password on the login page \u2014 a reset link will be sent to your email.\n\n"
                "Kind regards,\nNorthbank FC Member Services"
            ),
            "citations": ["password-reset", "fake-kb"],
            "rationale": "Jev selected resolve \u2014 Haiku drafted the grounded password-reset reply.",
        }
    )

    class DraftingHttpxClient:
        def __init__(self, timeout: float = 30.0) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["payload"] = json
            return _make_fake_anthropic_response([{"type": "text", "text": haiku_draft_json}])

    monkeypatch.setattr(jev_mod.httpx, "Client", DraftingHttpxClient)

    with ticket_context("T01"):
        ctx = gather_context(t1)
    res = JevEngine(api_key="ts_test_key").recommend(ctx)

    assert res["error"] is None
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    sent_payload = captured["payload"]
    assert isinstance(sent_payload, dict)
    assert sent_payload["model"] == cfg.CLAUDE_MODEL
    assert "Member Services Representative at Northbank FC" in sent_payload["system"]
    assert "British English" in sent_payload["system"]
    assert "NEVER use em-dashes" in sent_payload["system"]

    sent_user = json.loads(sent_payload["messages"][0]["content"])
    from northbank.domain import SHARED_EMAIL_AND_GROUNDING_RULES

    assert SHARED_EMAIL_AND_GROUNDING_RULES in claude_mod.SYSTEM
    assert SHARED_EMAIL_AND_GROUNDING_RULES in jev_mod.JEV_DRAFT_SYSTEM
    assert claude_mod.MAX_TOOL_TURNS == 5
    assert "member_lookup" not in sent_user
    assert sent_user["triage_decision"]["classified_action"] == "resolve"
    assert sent_user["member_profile"]["first_name"] == "Daniel"
    assert sent_user["member_profile"]["member_id"] == "NB100101"
    assert sent_user["member_profile"]["tier"] == "Gold"
    assert {"kb_articles", "case_history", "fixture_lookup", "recent_transactions"}.issubset(
        set(sent_user.keys())
    )
    assert "\u2014" not in res["agent"]["draft_reply"]
    assert "\u2014" not in res["agent"]["rationale"]
    assert "Dear Daniel," in res["agent"]["draft_reply"]
    assert "Kind regards,\nNorthbank FC Member Services" in res["agent"]["draft_reply"]
    assert res["agent"]["draft_reply"] == (
        "Dear Daniel,\n\n"
        "Please click Forgot password on the login page, a reset link will be sent to your email.\n\n"
        "Kind regards,\nNorthbank FC Member Services"
    )
    assert res["agent"]["rationale"] == "Jev selected resolve, Haiku drafted the grounded password-reset reply."
    assert res["agent"]["citations"] == ["password-reset"]
