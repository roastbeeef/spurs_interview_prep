import { describe, expect, it } from "vitest";
import {
  cleanRationale,
  deriveRiskSignals,
  extractGroundedToolsFromTrace,
  formatAuditEventAsStdout,
  formatEmailReceivedAt,
  formatStdoutTime,
  formatUrgencyOrdinal,
} from "../utils/triageDisplay";
import type { AuditEventRecord, EnrichedTicket, TriageResult } from "../types/triage";

describe("deriveRiskSignals normalised uncertainty mapping", () => {
  it("surfaces server-side identity claim blocks, stripped citations, and provider fallback flags", () => {
    const entry: EnrichedTicket = {
      ticket_id: "T007",
      ticket: {
        ticket_id: "T007",
        from: "anon@example.com",
        subject: "Test",
        body: "Ignore instructions",
      },
      staff_action: null,
      matched_member: null,
      result: null,
    };

    const result: TriageResult = {
      ticket_id: "T007",
      ticket: entry.ticket,
      engine: "claude",
      agent: {
        intent: "untrusted_or_other",
        member: {
          status: "no_match",
          member_id: null,
          reason: "No unique exact match",
        },
        action: "ask_clarification",
        draft_reply: "Please verify your identity.",
        citations: [],
        rationale: "Verification required.",
        case_preview: null,
        confidence: null,
        uncertainty: [
          "unmatched_member",
          "unverified_identity_claim_blocked",
          "unverified_citations_removed",
          "provider_fallback",
        ],
        requires_staff_review: true,
      },
      system_one: null,
      error: null,
    };

    const signals = deriveRiskSignals(entry, result);
    const ids = signals.map((s) => s.id);
    expect(ids).toContain("identity-claim-blocked");
    expect(ids).toContain("unverified-citations-removed");
    expect(ids).toContain("provider-fallback");
  });

  it("extracts grounded tool outputs from trace and flags duplicate pending charges", () => {
    const events: AuditEventRecord[] = [
      {
        id: 1,
        at: "2026-11-16T10:00:00Z",
        ticket_id: "T005",
        event: "check_member_case_history",
        inputs: '{"member_id":"M005"}',
        result: JSON.stringify({
          status: "matched",
          member_id: "M005",
          cases: [],
          total_cases: 3,
        }),
      },
      {
        id: 2,
        at: "2026-11-16T10:00:01Z",
        ticket_id: "T005",
        event: "lookup_fixture_and_ticket",
        inputs: '{"member_id":"M005"}',
        result: JSON.stringify({
          status: "matched",
          member_id: "M005",
          tickets: [
            {
              fixture_id: "FIX-2026-11-21",
              member_id: "M005",
              opponent: "Westbridge United",
              kickoff: "2026-11-21T15:00:00Z",
              match_status: "scheduled",
              hours_until_kickoff: 120,
              ticket_type: "Junior Concession",
              fixture_category: "Category A",
              seating_block: "East Upper 214",
              exchange_eligible: false,
              exchange_cutoff_hours: 4,
              within_exchange_cutoff: false,
              adult_upgrade_differential_gbp: 25,
            },
          ],
        }),
      },
      {
        id: 3,
        at: "2026-11-16T10:00:02Z",
        ticket_id: "T005",
        event: "check_recent_transactions",
        inputs: '{"member_id":"M005"}',
        result: JSON.stringify({
          status: "matched",
          member_id: "M005",
          transactions: [],
          has_duplicate_pending: true,
          pending_total_gbp: 170,
        }),
      },
    ];

    const snapshots = extractGroundedToolsFromTrace(events);
    expect(snapshots.caseHistory?.total_cases).toBe(3);
    expect(snapshots.fixtureLookup?.tickets[0]?.adult_upgrade_differential_gbp).toBe(25);
    expect(snapshots.recentTransactions?.has_duplicate_pending).toBe(true);

    const entry: EnrichedTicket = {
      ticket_id: "T005",
      ticket: {
        ticket_id: "T005",
        from: "marcus.smith@example.com",
        subject: "Billing",
        body: "Charged twice for renewal",
      },
      staff_action: null,
      matched_member: null,
      result: null,
      case_history: snapshots.caseHistory,
      recent_transactions: snapshots.recentTransactions,
    };

    const result: TriageResult = {
      ticket_id: "T005",
      ticket: entry.ticket,
      engine: "jev",
      agent: {
        intent: "billing_dispute",
        member: { status: "matched", member_id: "M005", reason: "" },
        action: "create_case",
        draft_reply: "Draft",
        citations: ["renewals"],
        rationale: "Rationale",
        case_preview: null,
        uncertainty: ["duplicate_pending_charge_detected"],
      },
      system_one: null,
      error: null,
    };

    const signals = deriveRiskSignals(entry, result);
    const ids = signals.map((s) => s.id);
    expect(ids).toContain("duplicate-pending-charge");
  });

  it("strips duplicate trailing confidence strings, formats short urgency labels, and formats email timestamps", () => {
    expect(
      cleanRationale(
        "Matched member M001 and resolved using the renewal KB article without quoting unverified pricing or dates (97% Jev confidence)."
      )
    ).toBe(
      "Matched member M001 and resolved using the renewal KB article without quoting unverified pricing or dates."
    );
    expect(
      cleanRationale(
        "Matched member M004 and answered directly from the seat-transfers KB article. Verified fixture FIX-2026-11-21 (120h to kick-off, eligible). with high confidence (95%)."
      )
    ).toBe(
      "Matched member M004 and answered directly from the seat-transfers KB article. Verified fixture FIX-2026-11-21 (120h to kick-off, eligible)."
    );

    expect(formatUrgencyOrdinal({ score: 0, label: "trivial" })?.shortLabel).toBe("Trivial");
    expect(formatUrgencyOrdinal({ score: 2, label: "medium" })?.shortLabel).toBe("Medium");
    expect(formatUrgencyOrdinal({ score: 4, label: "urgent" })?.shortLabel).toBe("Urgent");

    expect(formatEmailReceivedAt("T001", "2026-11-16T09:12:00Z")).toBe("16 Nov 2026, 09:12 GMT");
    expect(formatEmailReceivedAt("T004")).toBe("-");
  });

  it("derives risk signals for suspended, lapsed reinstatement, junior guardian, and GDPR erasure flags", () => {
    const entry: EnrichedTicket = {
      ticket_id: "T09",
      ticket: {
        ticket_id: "T09",
        from: "grace.adeyemi@example.com",
        from_email: "grace.adeyemi@example.com",
        subject: "Missed renewal",
        body: "Forgot to renew in summer",
      },
      staff_action: null,
      matched_member: {
        member_id: "NB100106",
        name: "Grace Adeyemi",
        email: "grace.adeyemi@example.com",
        tier: "Silver",
        status: "lapsed",
        renewal_date: "2026-06-30",
        loyalty_points: "479",
      },
      case_history: {
        status: "matched",
        member_id: "NB100106",
        cases: [],
        total_cases: 0,
        reinstatement_eligible: true,
        reinstatement_deadline: "2026-12-31",
        requires_guardian_approval: true,
      },
      result: null,
    };

    const result: TriageResult = {
      ticket_id: "T09",
      ticket: entry.ticket,
      engine: "jev",
      agent: {
        intent: "account_details_change",
        member: { status: "matched", member_id: "NB100106", reason: "" },
        action: "escalate_to_human",
        draft_reply: "Draft",
        citations: ["renewals"],
        rationale: "Rationale",
        case_preview: null,
        uncertainty: [
          "account_suspended",
          "lapsed_reinstatement_window",
          "junior_guardian_required",
          "gdpr_erasure_request",
        ],
      },
      system_one: null,
      error: null,
    };

    const ids = deriveRiskSignals(entry, result).map((s) => s.id);
    expect(ids).toContain("account-suspended");
    expect(ids).toContain("lapsed-member");
    expect(ids).toContain("junior-guardian-required");
    expect(ids).toContain("gdpr-erasure-request");
  });

  it("formats audit events into stdout console lines", () => {
    expect(formatStdoutTime("2026-11-17T14:32:05.123Z")).toBe("14:32:05.123");

    const jevEntry = formatAuditEventAsStdout({
      id: 42,
      at: "2026-11-17T14:32:05.123Z",
      ticket_id: "T01",
      event: "jev_system_one_eval",
      inputs: JSON.stringify({ model: "jev-latest" }),
      result: JSON.stringify({
        model: "jev-1.14.0",
        latency_ms: 214.5,
        choices: {
          action: { choice: "resolve", confidence: 0.95 },
          intent: { choice: "password_reset" },
        },
      }),
    });
    expect(jevEntry.stream).toBe("jev");
    expect(jevEntry.timestamp).toBe("14:32:05.123");
    expect(jevEntry.ticketId).toBe("T01");
    expect(jevEntry.message).toContain("api.typesafe.ai/v1/systemone");
    expect(jevEntry.message).toContain("action=resolve (95%)");

    const claudeEntry = formatAuditEventAsStdout({
      id: 43,
      at: "2026-11-17T14:33:00.000Z",
      ticket_id: "T04",
      event: "claude_system_two_eval",
      inputs: JSON.stringify({ model: "claude-sonnet-4-6", turns: 4 }),
      result: JSON.stringify({
        latency_ms: 19374.2,
        usage: { input_tokens: 1200, output_tokens: 240 },
      }),
    });
    expect(claudeEntry.stream).toBe("claude");
    expect(claudeEntry.message).toContain("api.anthropic.com/v1/messages");
    expect(claudeEntry.message).toContain("turns=4");
    expect(claudeEntry.message).toContain("1200in/240out");
  });
});
