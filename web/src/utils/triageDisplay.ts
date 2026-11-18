import type {
  AuditEventRecord,
  ConsoleLogEntry,
  ConsoleLogStream,
  EnrichedTicket,
  FixtureTicketLookup,
  MemberCaseHistory,
  RecentTransactionsLookup,
  StaffActionRecord,
  TriageAction,
  TriageResult,
} from "../types/triage";

export interface ActionMeta {
  label: string;
  shortLabel: string;
  primaryButtonLabel: string;
  description: string;
  tone: "emerald" | "amber" | "crimson" | "neutral";
}

export const ACTION_META: Record<TriageAction | "rejected" | "pending", ActionMeta> = {
  resolve: {
    label: "Send Grounded Reply",
    shortLabel: "Resolve",
    primaryButtonLabel: "Approve & Send Reply",
    description: "Answered directly from approved Northbank FC help articles; no SQLite case required.",
    tone: "emerald",
  },
  create_case: {
    label: "Propose Support Case",
    shortLabel: "Case Proposal",
    primaryButtonLabel: "Approve & Create Case",
    description: "Policy requires staff action; preview validated via MCP create_case awaiting human sign-off.",
    tone: "amber",
  },
  escalate_to_human: {
    label: "Escalate to Specialist",
    shortLabel: "Escalate",
    primaryButtonLabel: "Confirm Specialist Escalation",
    description: "Urgent billing, portal discrepancy, or complex issue requiring specialist review.",
    tone: "crimson",
  },
  ask_clarification: {
    label: "Request Verification",
    shortLabel: "Verify Sender",
    primaryButtonLabel: "Approve Verification Request",
    description: "Identity could not be uniquely verified or request triggered safety checks.",
    tone: "crimson",
  },
  rejected: {
    label: "Proposal Rejected",
    shortLabel: "Rejected",
    primaryButtonLabel: "Rejected",
    description: "Staff declined the proposed support case.",
    tone: "crimson",
  },
  pending: {
    label: "Not Triaged",
    shortLabel: "Untriaged",
    primaryButtonLabel: "Run Triage",
    description: "No model recommendation generated yet.",
    tone: "neutral",
  },
};

export const INTENT_LABELS: Record<string, string> = {
  password_reset: "Password Reset",
  membership_renewal: "Membership Renewal",
  billing_dispute: "Billing Dispute",
  seat_transfer: "Seat Transfer",
  membership_cancellation: "Membership Cancellation",
  account_details_change: "Account Details Change",
  junior_membership: "Junior Membership",
  loyalty_points: "Loyalty Points & Ballots",
  account_status_or_upgrade: "Account Status / Upgrade",
  untrusted_or_other: "Untrusted / Other",
};

export const CASE_CATEGORY_LABELS: Record<string, string> = {
  cancellation: "Membership Cancellation",
  reinstatement: "Lapsed Reinstatement",
  billing_investigation: "Billing Investigation",
  account_update: "Account Update",
  general: "General Follow-up",
};

export function getActionMeta(action: string | null | undefined): ActionMeta {
  if (action && action in ACTION_META) {
    return ACTION_META[action as keyof typeof ACTION_META];
  }
  return ACTION_META.pending;
}

export function formatIntent(intent: string | null | undefined): string {
  if (!intent) return "Not classified";
  return INTENT_LABELS[intent] ?? intent.replaceAll("_", " ");
}

export function formatCaseCategory(category: string | null | undefined): string {
  if (!category) return "General";
  return CASE_CATEGORY_LABELS[category] ?? category.replaceAll("_", " ");
}

export const URGENCY_LABELS: Record<number, string> = {
  0: "trivial",
  1: "low",
  2: "medium",
  3: "high",
  4: "urgent",
};

function toShortUrgencyLabel(raw: string, level: number): string {
  const normalised = raw.trim().toLowerCase();
  const single = URGENCY_LABELS[level] ?? normalised;
  const target =
    normalised === "trivial" ||
    normalised === "low" ||
    normalised === "medium" ||
    normalised === "high" ||
    normalised === "urgent"
      ? normalised
      : single;
  return target ? target.charAt(0).toUpperCase() + target.slice(1) : String(level);
}

export function formatUrgencyOrdinal(
  scoreObj?: { score?: number; legend?: Record<string, string>; label?: string } | null
): { level: number; label: string; shortLabel: string; display: string } | null {
  if (!scoreObj || typeof scoreObj.score !== "number" || Number.isNaN(scoreObj.score)) {
    return null;
  }
  const level = Math.max(0, Math.min(4, Math.round(scoreObj.score)));
  const label =
    scoreObj.label ||
    scoreObj.legend?.[String(level)] ||
    URGENCY_LABELS[level] ||
    String(level);
  const shortLabel = toShortUrgencyLabel(label, level);
  return { level, label, shortLabel, display: `${level}: ${label}` };
}

export function cleanRationale(rationale: string | null | undefined): string {
  if (!rationale) return "";
  return rationale
    .trim()
    .replace(/\s+with high confidence\s*\(\d+(?:\.\d+)?%\)(\.?)\s*$/i, "$1")
    .replace(/\s*\(\d+(?:\.\d+)?%(?:\s+Jev)?(?:\s+confidence)?\)(\.?)\s*$/i, "$1")
    .replace(/\.{2,}$/, ".")
    .trim();
}

export function formatEmailReceivedAt(_ticketId: string, receivedAt?: string): string {
  if (receivedAt) {
    const d = new Date(receivedAt);
    if (!Number.isNaN(d.getTime())) {
      const formatted = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }).format(d);
      return `${formatted} GMT`;
    }
  }
  return "-";
}

export interface RiskSignal {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
}

export function deriveRiskSignals(
  entry: EnrichedTicket,
  result: TriageResult | null
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  if (!result || result.error || !result.agent) {
    return signals;
  }

  const { agent, system_one: sys1 } = result;
  const uncertainty = agent.uncertainty ?? [];
  const injectionNoul = sys1?.nouls?.prompt_injection_risk?.noul;
  const kbGroundedNoul = sys1?.nouls?.kb_grounded?.noul;
  const urgency = formatUrgencyOrdinal(sys1?.scores?.urgency);

  if (uncertainty.includes("unverified_identity_claim_blocked")) {
    signals.push({
      id: "identity-claim-blocked",
      severity: "critical",
      title: "Unverified identity claim blocked",
      detail:
        "Model output attempted to reference an unverified member record; server enforced no_match.",
    });
  }

  if (uncertainty.includes("unverified_citations_removed")) {
    signals.push({
      id: "unverified-citations-removed",
      severity: "warning",
      title: "Unverified KB citations stripped",
      detail:
        "Server removed citation IDs that were not present in the approved knowledge base.",
    });
  }

  if (uncertainty.includes("provider_fallback") || sys1?.fallback_reason) {
    signals.push({
      id: "provider-fallback",
      severity: "info",
      title: "Fallback model used",
      detail:
        sys1?.fallback_reason ||
        "Primary engine was unavailable; automatically fell back to the alternate model.",
    });
  }

  if (typeof injectionNoul === "number" && injectionNoul >= 0.5) {
    signals.push({
      id: "prompt-injection",
      severity: "critical",
      title: `Prompt injection gate triggered (${Math.round(injectionNoul * 100)}%)`,
      detail:
        "Email body contains instruction-override language. Treated strictly as untrusted data; account claims ignored.",
    });
  }

  if (agent.member.status !== "matched") {
    signals.push({
      id: "unmatched-member",
      severity: "critical",
      title: "Sender identity unverified",
      detail:
        agent.member.reason ||
        "No exact match in member directory. Do not disclose account details or create a case.",
    });
  }

  if (entry.matched_member && entry.matched_member.status.toLowerCase() === "expired") {
    signals.push({
      id: "expired-member",
      severity: "warning",
      title: `Membership status is expired (${entry.matched_member.renewal_date})`,
      detail:
        "Expired account status may explain missing portal renewal actions; verify payment state before modifying access.",
    });
  }

  if (
    uncertainty.includes("account_suspended") ||
    entry.matched_member?.status?.toLowerCase() === "suspended" ||
    entry.case_history?.is_suspended
  ) {
    signals.push({
      id: "account-suspended",
      severity: "critical",
      title: "Account status is suspended",
      detail:
        "Account is currently suspended and requires manual specialist investigation before lifting restrictions or selling tickets.",
    });
  }

  if (
    uncertainty.includes("lapsed_reinstatement_window") ||
    entry.matched_member?.status?.toLowerCase() === "lapsed"
  ) {
    const deadline = entry.case_history?.reinstatement_deadline || "2026-12-31";
    signals.push({
      id: "lapsed-member",
      severity: "warning",
      title: `Membership status is lapsed (reinstatement window until ${deadline})`,
      detail:
        "Renewal window closed 30 June; Member Services may review reinstatement before 31 December subject to availability (seat not guaranteed).",
    });
  }

  if (
    uncertainty.includes("junior_guardian_required") ||
    (entry.case_history?.requires_guardian_approval && agent.intent === "account_details_change")
  ) {
    signals.push({
      id: "junior-guardian-required",
      severity: "info",
      title: "Junior account: parent/guardian management applies",
      detail:
        "Per update-details policy, Junior members' account details are managed by the parent or guardian linked to the account.",
    });
  }

  if (uncertainty.includes("gdpr_erasure_request")) {
    signals.push({
      id: "gdpr-erasure-request",
      severity: "critical",
      title: "GDPR personal data erasure request",
      detail:
        "Statutory data deletion and account closure request requires specialist human verification and compliance workflow.",
    });
  }

  if (
    uncertainty.includes("duplicate_pending_charge_detected") ||
    entry.recent_transactions?.has_duplicate_pending
  ) {
    const pendingTotal = entry.recent_transactions?.pending_total_gbp;
    signals.push({
      id: "duplicate-pending-charge",
      severity: "critical",
      title:
        typeof pendingTotal === "number" && pendingTotal > 0
          ? `Duplicate pending charges detected (£${pendingTotal.toFixed(2)})`
          : "Duplicate pending charges detected",
      detail:
        "Recent billing ledger shows multiple pending authorisations; escalate to billing specialist before modifying renewal access.",
    });
  }

  if (urgency && urgency.level >= 3) {
    signals.push({
      id: "high-urgency",
      severity: "critical",
      title: `Urgent operational priority (${urgency.display})`,
      detail: "Model flagged high/urgent operational priority requiring prompt staff review.",
    });
  }

  if (typeof kbGroundedNoul === "number" && kbGroundedNoul < 0.5) {
    signals.push({
      id: "low-kb-grounding",
      severity: "warning",
      title: `Limited KB policy grounding (${Math.round(kbGroundedNoul * 100)}%)`,
      detail:
        "Approved KB articles do not fully cover this request. Avoid inventing pricing, refunds, or timelines.",
    });
  } else if (agent.citations.length === 0) {
    signals.push({
      id: "no-citations",
      severity: "warning",
      title: "No KB article cited",
      detail: "Recommendation does not rely on a specific KB article; verify reply wording manually.",
    });
  }

  return signals;
}

export function getStaffOutcomeLabel(staff: StaffActionRecord): {
  label: string;
  tone: "emerald" | "amber" | "crimson";
} {
  if (staff.decision_type === "reject_case" || staff.final_action === "rejected") {
    return { label: "Case Rejected", tone: "crimson" };
  }
  if (staff.case_id) {
    return { label: "Case Created", tone: "emerald" };
  }
  if (staff.decision_type === "override") {
    return {
      label: `Overridden -> ${getActionMeta(staff.final_action).shortLabel}`,
      tone: "amber",
    };
  }
  const meta = getActionMeta(staff.final_action);
  return {
    label:
      staff.final_action === "resolve"
        ? "Reply Approved"
        : staff.final_action === "escalate_to_human"
          ? "Escalated"
          : staff.final_action === "ask_clarification"
            ? "Verification Sent"
            : meta.shortLabel,
    tone: meta.tone === "neutral" ? "emerald" : meta.tone,
  };
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatKbArticleTitle(articleId: string, content: string | undefined): string {
  if (content) {
    const firstHeading = content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("#"));
    if (firstHeading) {
      return firstHeading.replace(/^#+\s*/, "").trim();
    }
  }
  return articleId.replaceAll("_", " ");
}

export function extractKbSearchScores(events: AuditEventRecord[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const ev of events) {
    if (ev.event !== "search_kb") continue;
    try {
      const parsed = JSON.parse(ev.result) as {
        articles?: Array<{ article_id?: string; score?: number }>;
      };
      for (const art of parsed.articles ?? []) {
        if (art.article_id && typeof art.score === "number") {
          scores[art.article_id] = art.score;
        }
      }
    } catch {
      // Ignore malformed trace rows
    }
  }
  return scores;
}

export interface GroundedToolSnapshots {
  caseHistory: MemberCaseHistory | null;
  fixtureLookup: FixtureTicketLookup | null;
  recentTransactions: RecentTransactionsLookup | null;
}

export function extractGroundedToolsFromTrace(
  events: AuditEventRecord[]
): GroundedToolSnapshots {
  const snapshots: GroundedToolSnapshots = {
    caseHistory: null,
    fixtureLookup: null,
    recentTransactions: null,
  };
  for (const ev of events) {
    try {
      if (ev.event === "check_member_case_history") {
        const parsed = JSON.parse(ev.result) as MemberCaseHistory;
        if (parsed && typeof parsed === "object" && "status" in parsed) {
          snapshots.caseHistory = parsed;
        }
      } else if (ev.event === "lookup_fixture_and_ticket") {
        const parsed = JSON.parse(ev.result) as FixtureTicketLookup;
        if (parsed && typeof parsed === "object" && "status" in parsed) {
          snapshots.fixtureLookup = parsed;
        }
      } else if (ev.event === "check_recent_transactions") {
        const parsed = JSON.parse(ev.result) as RecentTransactionsLookup;
        if (parsed && typeof parsed === "object" && "status" in parsed) {
          snapshots.recentTransactions = parsed;
        }
      }
    } catch {
      // Ignore malformed trace rows
    }
  }
  return snapshots;
}

function safeParseJsonObj(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function formatStdoutTime(isoOrDate?: string | Date): string {
  const d =
    isoOrDate instanceof Date
      ? isoOrDate
      : isoOrDate
        ? new Date(isoOrDate)
        : new Date();
  if (Number.isNaN(d.getTime())) {
    return typeof isoOrDate === "string" ? isoOrDate : "00:00:00.000";
  }
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function formatAuditEventAsStdout(ev: AuditEventRecord): ConsoleLogEntry {
  const inputs = safeParseJsonObj(ev.inputs);
  const result = safeParseJsonObj(ev.result);
  const timestamp = formatStdoutTime(ev.at);
  let stream: ConsoleLogStream = "mcp";
  let message = `${ev.event}(${ev.inputs}) -> ${ev.result}`;

  if (ev.event === "jev_system_one_eval") {
    stream = "jev";
    const latency = typeof result.latency_ms === "number" ? `${result.latency_ms.toFixed(1)}ms` : "-";
    const model = String(result.model || inputs.model || "jev-latest");
    const choices = (result.choices as Record<string, Record<string, unknown>> | undefined) ?? {};
    const actionChoice = choices.action?.choice;
    const actionConf = choices.action?.confidence;
    const intentChoice = choices.intent?.choice;
    const confStr = typeof actionConf === "number" ? ` (${Math.round(actionConf * 100)}%)` : "";
    message = `POST https://api.typesafe.ai/v1/systemone -> 200 OK (${latency}) model=${model} action=${actionChoice ?? "?"}${confStr} intent=${intentChoice ?? "?"}`;
  } else if (ev.event === "claude_system_two_eval") {
    stream = "claude";
    const latency = typeof result.latency_ms === "number" ? `${result.latency_ms.toFixed(1)}ms` : "-";
    const model = String(inputs.model || "claude-haiku-4-5");
    const turns = inputs.turns ?? "?";
    const usage = (result.usage as Record<string, unknown> | undefined) ?? {};
    message = `POST https://api.anthropic.com/v1/messages -> 200 OK (${latency}) model=${model} turns=${turns} tokens=${usage.input_tokens ?? 0}in/${usage.output_tokens ?? 0}out`;
  } else if (ev.event === "lookup_member") {
    const member = (result.member as Record<string, unknown> | undefined) ?? {};
    const status = String(result.status || "unknown");
    const detail =
      status === "matched"
        ? `matched ${member.member_id ?? "?"} (${member.tier ?? "?"}/${member.status ?? "?"})`
        : `${status}${result.ambiguous ? " ambiguous=true" : ""}`;
    message = `mcp.lookup_member(email=${JSON.stringify(inputs.email ?? "")}, id=${JSON.stringify(inputs.member_id ?? "")}) -> ${detail}`;
  } else if (ev.event === "search_kb") {
    const articles = Array.isArray(result.articles)
      ? (result.articles as Array<Record<string, unknown>>)
      : [];
    const ids = articles.map((a) => `${a.article_id}(${Number(a.score ?? 0).toFixed(2)})`).join(", ");
    message = `mcp.search_kb(query=${JSON.stringify(String(inputs.query ?? "").slice(0, 48))}) -> [${ids || "none"}]`;
  } else if (ev.event === "check_member_case_history") {
    message = `mcp.check_member_case_history(member_id=${JSON.stringify(inputs.member_id ?? "")}) -> status=${result.status ?? "?"} cases=${result.total_cases ?? 0}`;
  } else if (ev.event === "lookup_fixture_and_ticket") {
    const count = Array.isArray(result.tickets) ? result.tickets.length : 0;
    message = `mcp.lookup_fixture_and_ticket(member_id=${JSON.stringify(inputs.member_id ?? "")}) -> ${count} fixture(s)`;
  } else if (ev.event === "check_recent_transactions") {
    const count = Array.isArray(result.transactions) ? result.transactions.length : 0;
    const dup = result.has_duplicate_pending ? " duplicate_pending=true" : "";
    message = `mcp.check_recent_transactions(member_id=${JSON.stringify(inputs.member_id ?? "")}) -> ${count} tx(s)${dup}`;
  } else if (ev.event === "create_case") {
    const status = String(result.status || "?");
    const extra =
      status === "preview"
        ? `preview_id=${String(result.preview_id ?? "").slice(0, 8)} cat=${result.category ?? "?"}`
        : `reason=${result.reason ?? "?"}`;
    message = `mcp.create_case(member_id=${JSON.stringify(inputs.member_id ?? "")}, cat=${JSON.stringify(inputs.category ?? "")}) -> ${status} (${extra})`;
  } else if (ev.event === "staff_action" || ev.event === "approval" || ev.event === "rejection") {
    stream = "staff";
    message = `${ev.event}: decision=${result.decision_type ?? result.status ?? ev.event} final=${result.final_action ?? result.category ?? "recorded"} actor=${inputs.actor ?? result.actor ?? "staff"}`;
  }

  return {
    id: `audit-${ev.id}`,
    timestamp,
    stream,
    ticketId: ev.ticket_id,
    message,
  };
}
