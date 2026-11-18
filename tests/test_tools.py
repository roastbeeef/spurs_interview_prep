import pytest
from fastapi.testclient import TestClient

from northbank.agent import load_tickets, run_one
from northbank.server import app
from northbank.store import (
    approve_case,
    audit,
    connect,
    list_cases,
    list_staff_actions,
    record_staff_action,
    trace,
)
from northbank.tools import (
    check_member_case_history_impl,
    check_recent_transactions_impl,
    create_case_impl,
    lookup_fixture_and_ticket_impl,
    lookup_member_impl,
    search_kb_impl,
)


def test_lookup_exact_and_unknown_and_homonyms():
    m1 = lookup_member_impl(email="daniel.hughes@example.com")
    assert m1["status"] == "matched"
    assert m1["member"]["member_id"] == "NB100101"
    assert m1["member"]["name"] == "Daniel Hughes"

    # Nonexistent sender/ID returns no_match
    assert lookup_member_impl(email="r.whitfield@example.com", member_id="NB199999")["status"] == "no_match"
    # Conflicting email and member_id flags ambiguity
    conflict = lookup_member_impl(email="daniel.hughes@example.com", member_id="NB100102")
    assert conflict["status"] == "no_match"
    assert conflict["ambiguous"] is True

    # Two members named James Carter: name-only lookup is ambiguous, email lookup disambiguates
    name_ambig = lookup_member_impl(name="James Carter")
    assert name_ambig["status"] == "no_match"
    assert name_ambig["ambiguous"] is True

    jcarter = lookup_member_impl(email="jcarter.n17@example.com")
    assert jcarter["status"] == "matched"
    assert jcarter["member"]["member_id"] == "NB100108"
    assert jcarter["homonym_member_ids"] == ["NB100107"]


def test_kb_local():
    pwd_hits = search_kb_impl("forgot password log in")["articles"]
    assert pwd_hits[0]["article_id"] == "password-reset"

    transfer_hits = search_kb_impl("transfer seat to my son")["articles"]
    assert transfer_hits[0]["article_id"] == "seat-transfers"

    cancel_hits = search_kb_impl("cancel membership")["articles"]
    assert cancel_hits[0]["article_id"] == "cancellations"

    points_hits = search_kb_impl("away ballot loyalty points balance")["articles"]
    assert points_hits[0]["article_id"] == "loyalty-points"

    for hits in (pwd_hits, transfer_hits, cancel_hits, points_hits):
        scores = [h["score"] for h in hits]
        assert scores == sorted(scores, reverse=True)
        assert all(isinstance(s, float) and 0.0 < s <= 1.0 for s in scores)

    assert search_kb_impl("completely unrelated basketball query")["articles"] == []


def test_create_case_only_preview(tmp_path, monkeypatch):
    import northbank.store as store

    monkeypatch.setattr(store, "DB", tmp_path / "test.sqlite3")
    invalid = create_case_impl("UNKNOWN", "misc", "help")
    assert invalid["status"] == "refused"
    proposal = create_case_impl("NB100104", "cancellation", "Cancel at season end")
    assert proposal["status"] == "preview"
    with connect() as db:
        assert db.execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 0
    audit("create_case", {"member_id": "NB100104"}, proposal, ticket_id="TTEST")
    case = approve_case(proposal["preview_id"], "TTEST")
    assert case["member_id"] == "NB100104"
    with pytest.raises(ValueError):
        approve_case(proposal["preview_id"], "TTEST")


def test_run_one_jev_triage_and_guardrails(tmp_path, monkeypatch):
    import northbank.store as store

    monkeypatch.setattr(store, "DB", tmp_path / "jev.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}
    assert len(tickets) == 15

    r1 = run_one(tickets["T01"], engine="jev")
    assert r1["error"] is None
    assert r1["engine"] == "jev"
    assert r1["agent"]["action"] == "resolve"
    assert "password-reset" in r1["agent"]["citations"]
    assert "intent" in r1["system_one"]["choices"]
    assert "urgency" in r1["system_one"]["scores"]
    assert "kb_grounded" in r1["system_one"]["nouls"]
    assert r1["system_one"]["usage"]["output_tokens"] == 0

    r4 = run_one(tickets["T04"], engine="jev")
    assert r4["agent"]["action"] == "create_case"
    assert r4["agent"]["case_preview"]["status"] == "preview"
    assert r4["agent"]["case_preview"]["category"] == "cancellation"
    assert "cancellations" in r4["agent"]["citations"]
    assert list_cases() == []  # Never writes to cases before human approval
    events_t4 = [e["event"] for e in trace("T04")]
    assert "lookup_member" in events_t4
    assert "search_kb" in events_t4
    assert "jev_system_one_eval" in events_t4
    assert "create_case" in events_t4

    r5 = run_one(tickets["T05"], engine="jev")
    assert r5["agent"]["action"] == "ask_clarification"
    assert r5["agent"]["member"]["status"] == "no_match"
    assert r5["agent"]["case_preview"] is None

    r9 = run_one(tickets["T09"], engine="jev")
    assert r9["agent"]["action"] == "create_case"
    assert r9["agent"]["case_preview"]["category"] == "reinstatement"
    assert "lapsed_reinstatement_window" in r9["agent"]["uncertainty"]

    r11 = run_one(tickets["T11"], engine="jev")
    assert r11["agent"]["action"] == "resolve"
    assert "398 loyalty points" in r11["agent"]["draft_reply"]

    r12 = run_one(tickets["T12"], engine="jev")
    assert r12["agent"]["action"] == "escalate_to_human"
    assert r12["agent"]["member"]["member_id"] == "NB100112"
    assert r12["system_one"]["nouls"]["prompt_injection_risk"]["noul"] >= 0.8

    r13 = run_one(tickets["T13"], engine="jev")
    assert r13["agent"]["action"] == "escalate_to_human"
    assert "account_suspended" in r13["agent"]["uncertainty"]

    r14 = run_one(tickets["T14"], engine="jev")
    assert r14["agent"]["action"] == "escalate_to_human"
    assert "gdpr_erasure_request" in r14["agent"]["uncertainty"]


def test_record_staff_action_lifecycle(tmp_path, monkeypatch):
    import northbank.store as store

    monkeypatch.setattr(store, "DB", tmp_path / "actions.sqlite3")
    tickets = {t["ticket_id"]: t for t in load_tickets()}

    r4 = run_one(tickets["T04"], engine="jev")
    preview_id = r4["agent"]["case_preview"]["preview_id"]

    saved = record_staff_action(
        ticket_id="T04",
        recommended_action="create_case",
        final_action="create_case",
        decision_type="accept",
        reply_text=r4["agent"]["draft_reply"],
        notes="Approved cancellation case",
        preview_id=preview_id,
        engine="jev",
    )
    assert saved["case_id"] is not None
    assert len(list_cases()) == 1

    r1 = run_one(tickets["T01"], engine="jev")
    override = record_staff_action(
        ticket_id="T01",
        recommended_action=r1["agent"]["action"],
        final_action="escalate_to_human",
        decision_type="override",
        reply_text="Custom staff escalation",
        notes="Member VIP query",
        engine="jev",
    )
    assert override["final_action"] == "escalate_to_human"
    assert set(list_staff_actions().keys()) == {"T04", "T01"}


def test_fastapi_console_endpoints(tmp_path, monkeypatch):
    import northbank.config as cfg
    import northbank.server as srv
    import northbank.store as store

    db_path = tmp_path / "server.sqlite3"
    results_path = tmp_path / "results.json"
    monkeypatch.setattr(store, "DB", db_path)
    monkeypatch.setattr(cfg, "RESULTS", results_path)
    monkeypatch.setattr(srv, "RESULTS", results_path)

    client = TestClient(app)

    home = client.get("/")
    assert home.status_code == 200
    assert "Northbank FC" in home.text

    dash = client.get("/api/dashboard")
    assert dash.status_code == 200
    payload = dash.json()
    assert payload["telemetry"]["total_tickets"] == 15
    assert "cancellations" in payload["kb_articles"]
    assert "loyalty-points" in payload["kb_articles"]

    triage_t5 = client.post("/api/tickets/T05/triage", json={"engine": "jev"})
    assert triage_t5.status_code == 200

    triage_res = client.post("/api/tickets/T04/triage", json={"engine": "jev"})
    assert triage_res.status_code == 200
    triaged = triage_res.json()["result"]
    assert triaged["agent"]["action"] == "create_case"
    preview_id = triaged["agent"]["case_preview"]["preview_id"]

    tr_res = client.get("/api/tickets/T04/trace")
    assert tr_res.status_code == 200
    assert len(tr_res.json()["events"]) >= 4

    act_res = client.post(
        "/api/tickets/T04/action",
        json={
            "recommended_action": "create_case",
            "final_action": "create_case",
            "decision_type": "accept",
            "reply_text": triaged["agent"]["draft_reply"],
            "notes": "Approved via FastAPI test",
            "preview_id": preview_id,
            "engine": "jev",
        },
    )
    assert act_res.status_code == 200
    assert act_res.json()["staff_action"]["case_id"] is not None
    assert len(act_res.json()["cases"]) == 1

    triage_t2 = client.post("/api/tickets/T02/triage", json={"engine": "jev"})
    assert triage_t2.status_code == 200

    dash_after = client.get("/api/dashboard").json()
    assert dash_after["telemetry"]["actioned_count"] == 1
    assert dash_after["telemetry"]["approved_cases_count"] == 1
    assert "claude_api_key_configured" in dash_after["telemetry"]
    assert "typesafe_api_key_configured" in dash_after["telemetry"]
    assert dash_after["telemetry"]["jev_run_count"] >= 2
    assert len(dash_after["telemetry"]["latency_history"]) >= 2
    assert dash_after["telemetry"]["latency_history"][0]["engine"] == "jev"
    assert dash_after["telemetry"]["latency_history"][-1]["running_avg_ms"] == dash_after["telemetry"]["jev_avg_latency_ms"]
    by_tid = {item["ticket_id"]: item for item in dash_after["tickets"]}
    assert by_tid["T04"]["matched_member"]["member_id"] == "NB100104"
    assert by_tid["T04"]["matched_member"]["status"] == "active"
    assert by_tid["T04"]["case_history"]["status"] == "matched"
    assert by_tid["T04"]["case_history"]["total_cases"] == 1
    assert by_tid["T04"]["case_history"]["points_at_risk_on_cancel"] == 273
    assert by_tid["T02"]["recent_transactions"]["has_duplicate_pending"] is True
    assert by_tid["T02"]["recent_transactions"]["pending_total_gbp"] == 75.0
    assert by_tid["T05"]["matched_member"] is None
    assert by_tid["T05"]["case_history"] is None
    assert by_tid["T05"]["fixture_lookup"] is None
    assert by_tid["T05"]["recent_transactions"] is None

    reset_res = client.post("/api/reset")
    assert reset_res.status_code == 200
    reset_payload = reset_res.json()
    assert reset_payload["telemetry"]["actioned_count"] == 0
    assert reset_payload["telemetry"]["approved_cases_count"] == 0
    assert reset_payload["telemetry"]["triaged_count"] == 0
    assert reset_payload["cases"] == []
    assert reset_payload["recent_audit"] == []
    assert all(item["result"] is None and item["staff_action"] is None for item in reset_payload["tickets"])


def test_new_context_tools_matched_and_fail_closed(tmp_path, monkeypatch):
    import northbank.store as store

    monkeypatch.setattr(store, "DB", tmp_path / "context_tools.sqlite3")

    # Fail closed on missing or unmatched member IDs
    assert check_member_case_history_impl("")["status"] == "no_match"
    assert check_member_case_history_impl("UNKNOWN")["status"] == "no_match"
    assert lookup_fixture_and_ticket_impl("")["status"] == "no_match"
    assert lookup_fixture_and_ticket_impl("UNKNOWN")["status"] == "no_match"
    assert check_recent_transactions_impl("")["status"] == "no_match"
    assert check_recent_transactions_impl("UNKNOWN")["status"] == "no_match"

    # Fixture lookup checks postponed status for Kevin Doyle (NB100111) and transfer eligibility for NB100103
    f_mark = lookup_fixture_and_ticket_impl("NB100103", "Saturday's game")
    assert f_mark["status"] == "matched"
    assert f_mark["tickets"][0]["exchange_eligible"] is True
    assert f_mark["tickets"][0]["within_exchange_cutoff"] is False

    f_kevin = lookup_fixture_and_ticket_impl("NB100111")
    assert f_kevin["status"] == "matched"
    assert f_kevin["tickets"][0]["match_status"] == "postponed"
    assert f_kevin["tickets"][0]["within_exchange_cutoff"] is True

    # Recent transactions detects duplicate pending hold for NB100102 (Priya Shah)
    tx_priya = check_recent_transactions_impl("NB100102")
    assert tx_priya["status"] == "matched"
    assert tx_priya["has_duplicate_pending"] is True
    assert tx_priya["pending_total_gbp"] == 75.0

    # Enriched member intelligence: ballot standing, lapsed eligibility, guardian flag, homonyms, related tickets
    hist_tom = check_member_case_history_impl("NB100105")
    assert hist_tom["status"] == "matched"
    assert hist_tom["requires_guardian_approval"] is True
    assert [t["ticket_id"] for t in hist_tom["related_tickets"]] == ["T06", "T08"]

    hist_grace = check_member_case_history_impl("NB100106")
    assert hist_grace["reinstatement_eligible"] is True
    assert hist_grace["reinstatement_deadline"] == "2026-12-31"
    assert hist_grace["tenure_years"] == 4.5

    hist_james = check_member_case_history_impl("NB100108")
    assert hist_james["homonym_member_ids"] == ["NB100107"]
    assert hist_james["away_ballot_active_total"] == 41
    assert 1 <= hist_james["away_ballot_rank"] <= 41


def test_api_key_resolution_helpers(monkeypatch):
    from northbank.config import get_claude_api_key, get_typesafe_api_key

    monkeypatch.setenv("TYPESAFE_API_KEY", "  ts_env  ")
    monkeypatch.setenv("CLAUDE_API_KEY", "  sk-ant-env  ")
    assert get_typesafe_api_key() == "ts_env"
    assert get_typesafe_api_key("ts_override") == "ts_override"
    assert get_claude_api_key() == "sk-ant-env"
    assert get_claude_api_key("sk-ant-override") == "sk-ant-override"
