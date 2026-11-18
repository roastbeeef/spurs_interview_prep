import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Cpu,
  CreditCard,
  History,
  Play,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import type {
  ApprovedCaseRecord,
  AuditEventRecord,
  EngineType,
  EnrichedTicket,
  TriageResult,
} from "../../types/triage";
import {
  extractGroundedToolsFromTrace,
  extractKbSearchScores,
  formatIntent,
  formatKbArticleTitle,
  formatTimestamp,
  formatUrgencyOrdinal,
} from "../../utils/triageDisplay";
import { StatusBadge } from "../../components/StatusBadge";

export type InspectorTab = "evidence" | "telemetry" | "trace";

interface ContextInspectorPaneProps {
  entry: EnrichedTicket | null;
  displayedResult: TriageResult | null;
  engineHistory: Partial<Record<EngineType, TriageResult>> | undefined;
  kbArticles: Record<string, string>;
  approvedCases: ApprovedCaseRecord[];
  activeTrace: AuditEventRecord[];
  isLoadingTrace: boolean;
  traceError: string | null;
  highlightedArticleId: string | null;
  activeTab: InspectorTab;
  isTriaging: boolean;
  onTabChange: (tab: InspectorTab) => void;
  onSelectTicket?: (ticketId: string) => void;
  onRunComparisonEngine: (ticketId: string, engine: EngineType) => void;
  onReloadTrace: (ticketId: string) => void;
}

function safePrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function renderKbBody(content: string | undefined) {
  if (!content) return "(Article content unavailable)";
  const lines = content.split("\n");
  const withoutTitle = lines[0]?.trim().startsWith("#") ? lines.slice(1).join("\n").trim() : content.trim();
  const segments = withoutTitle.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((part, idx) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={idx} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={idx}>{part}</span>
    )
  );
}

export function ContextInspectorPane({
  entry,
  displayedResult,
  engineHistory,
  kbArticles,
  approvedCases,
  activeTrace,
  isLoadingTrace,
  traceError,
  highlightedArticleId,
  activeTab,
  isTriaging,
  onTabChange,
  onSelectTicket,
  onRunComparisonEngine,
  onReloadTrace,
}: ContextInspectorPaneProps) {
  const [showFullCorpus, setShowFullCorpus] = useState(false);

  const searchScores = useMemo(() => extractKbSearchScores(activeTrace), [activeTrace]);
  const traceTools = useMemo(() => extractGroundedToolsFromTrace(activeTrace), [activeTrace]);

  if (!entry) {
    return (
      <aside
        aria-label="Grounded context and telemetry inspector"
        className="flex h-full items-center justify-center border-slate-200 bg-white p-6 text-center lg:border-l"
      >
        <p className="text-xs text-slate-500">
          Member profile, KB policy evidence, and SQLite audit events appear here once a ticket is
          selected.
        </p>
      </aside>
    );
  }

  const agent = displayedResult?.agent ?? null;
  const memberMatched = agent?.member?.status === "matched";
  const matchedMember = memberMatched ? entry.matched_member : null;
  const matchedMemberId = memberMatched ? agent?.member?.member_id : null;

  const memberCases = matchedMemberId
    ? approvedCases.filter((c) => c.member_id === matchedMemberId)
    : [];

  const caseHistory = memberMatched
    ? (entry.case_history ??
      (traceTools.caseHistory?.status === "matched" &&
      traceTools.caseHistory.member_id === matchedMemberId
        ? traceTools.caseHistory
        : null))
    : null;
  const fixtureLookup = memberMatched
    ? (entry.fixture_lookup ??
      (traceTools.fixtureLookup?.status === "matched" &&
      traceTools.fixtureLookup.member_id === matchedMemberId
        ? traceTools.fixtureLookup
        : null))
    : null;
  const recentTransactions = memberMatched
    ? (entry.recent_transactions ??
      (traceTools.recentTransactions?.status === "matched" &&
      traceTools.recentTransactions.member_id === matchedMemberId
        ? traceTools.recentTransactions
        : null))
    : null;

  const citedIds = agent?.citations ?? [];
  const retrievedIds = Object.keys(searchScores);
  const prioritisedKbIds = Array.from(new Set([...citedIds, ...retrievedIds]));
  const remainingKbIds = Object.keys(kbArticles).filter((id) => !prioritisedKbIds.includes(id));

  const jevResult = engineHistory?.jev ?? null;
  const claudeResult = engineHistory?.claude ?? null;
  const alternateEngine: EngineType = displayedResult?.engine === "claude" ? "jev" : "claude";

  return (
    <aside
      aria-label="Grounded context and telemetry inspector"
      className="flex h-full min-h-0 flex-col border-slate-200 bg-white lg:border-l"
    >
      {/* Inspector Sub-Navigation */}
      <div
        role="tablist"
        aria-label="Context inspector views"
        className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 text-xs font-medium"
      >
        {(
          [
            { id: "evidence", label: "Member & KB", icon: BookOpen },
            { id: "telemetry", label: "Telemetry", icon: Activity },
            {
              id: "trace",
              label: `Audit (${activeTrace.length})`,
              icon: History,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`inspector-tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`inspector-panel-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex items-center justify-center gap-1.5 px-2 py-2.5 transition-colors ${
                isSelected
                  ? "bg-white font-semibold text-blue-800"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-700"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* TAB 1: MEMBER IDENTITY & APPROVED KB */}
        {activeTab === "evidence" ? (
          <div
            role="tabpanel"
            id="inspector-panel-evidence"
            aria-labelledby="inspector-tab-evidence"
            className="space-y-5"
          >
            {/* Member Record Section */}
            <section aria-label="Member lookup result">
              <div className="mb-2">
                <h3 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  Member
                </h3>
              </div>

              {memberMatched && agent?.member ? (
                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                      <div>
                        <div className="font-semibold text-slate-900">
                          {matchedMember?.name || agent.member.name || agent.member.member_id}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {matchedMember?.email || entry.ticket.from_email || entry.ticket.from}
                        </div>
                      </div>
                    </div>
                    <StatusBadge tone="navy" className="font-mono">
                      {agent.member.member_id}
                    </StatusBadge>
                  </div>

                  <dl className="mt-2.5 grid grid-cols-[100px_1fr] gap-x-2 gap-y-1.5">
                    <dt className="text-slate-500">Tier</dt>
                    <dd className="font-medium text-slate-900">
                      {matchedMember?.tier || agent.member.tier || "-"}
                    </dd>

                    <dt className="text-slate-500">Account Status</dt>
                    <dd>
                      {matchedMember ? (
                        <StatusBadge
                          tone={
                            matchedMember.status.toLowerCase() === "active"
                              ? "emerald"
                              : matchedMember.status.toLowerCase() === "lapsed"
                                ? "amber"
                                : "crimson"
                          }
                        >
                          {matchedMember.status}
                        </StatusBadge>
                      ) : (
                        <span className="text-slate-600">Matched</span>
                      )}
                    </dd>

                    {matchedMember?.joined || caseHistory?.joined ? (
                      <>
                        <dt className="text-slate-500">Joined</dt>
                        <dd className="font-mono text-[11px] text-slate-800 tabular-nums">
                          {matchedMember?.joined || caseHistory?.joined}
                          {typeof caseHistory?.tenure_years === "number"
                            ? ` (${caseHistory.tenure_years} yrs)`
                            : ""}
                        </dd>
                      </>
                    ) : null}

                    <dt className="text-slate-500">Renewal Date</dt>
                    <dd className="font-mono text-[11px] text-slate-800 tabular-nums">
                      {matchedMember?.renewal_date || "-"}
                    </dd>

                    <dt className="text-slate-500">Loyalty Points</dt>
                    <dd className="font-mono text-[11px] text-slate-800 tabular-nums">
                      {matchedMember?.loyalty_points ?? caseHistory?.loyalty_points ?? "-"}
                    </dd>

                    {typeof caseHistory?.away_ballot_rank === "number" &&
                    (caseHistory?.away_ballot_active_total ?? 0) > 0 ? (
                      <>
                        <dt className="text-slate-500">Away Ballot</dt>
                        <dd className="font-mono text-[11px] text-slate-800 tabular-nums">
                          #{caseHistory.away_ballot_rank} of {caseHistory.away_ballot_active_total}{" "}
                          (top{" "}
                          {Math.max(
                            1,
                            Math.round(
                              (caseHistory.away_ballot_rank /
                                caseHistory.away_ballot_active_total!) *
                                100
                            )
                          )}
                          %)
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  {caseHistory?.homonym_member_ids && caseHistory.homonym_member_ids.length > 0 ? (
                    <div className="mt-2.5 rounded border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-[11px] text-blue-950">
                      Disambiguated by email (shares name with{" "}
                      <span className="font-mono font-semibold">
                        {caseHistory.homonym_member_ids.join(", ")}
                      </span>
                      )
                    </div>
                  ) : null}

                  {!caseHistory && memberCases.length > 0 ? (
                    <div className="mt-3 border-t border-slate-200 pt-2">
                      <div className="text-[11px] font-semibold text-slate-600">
                        Cases ({memberCases.length})
                      </div>
                      <ul className="mt-1 space-y-1">
                        {memberCases.map((c) => (
                          <li
                            key={c.case_id}
                            className="rounded border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-[11px] text-emerald-950"
                          >
                            <span className="font-mono font-semibold">{c.category}</span> -{" "}
                            <span className="font-mono text-[10px]">{c.case_id.slice(0, 8)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50/60 p-3 text-xs text-red-950">
                  <div className="flex items-center gap-1.5 font-semibold text-red-900">
                    <UserX className="h-4 w-4 text-red-700" aria-hidden="true" />
                    <span>No Exact Member Match</span>
                  </div>
                  <p className="mt-1 leading-relaxed text-red-900">
                    {agent?.member?.reason ||
                      "Sender email and any extracted IDs did not uniquely match a directory row."}
                  </p>
                </div>
              )}
            </section>

            {/* Case History */}
            {memberMatched && caseHistory?.status === "matched" ? (
              <section aria-label="Case history">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    <ClipboardList className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Case History</span>
                  </h3>
                  <StatusBadge tone="neutral">
                    {caseHistory.total_cases} {caseHistory.total_cases === 1 ? "case" : "cases"}
                  </StatusBadge>
                </div>

                <div className="space-y-2.5 rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs [&>*:not(:first-child)]:border-t [&>*:not(:first-child)]:border-slate-200 [&>*:not(:first-child)]:pt-2">
                  {caseHistory.reinstatement_eligible ||
                  caseHistory.requires_guardian_approval ||
                  (typeof caseHistory.points_at_risk_on_cancel === "number" &&
                    caseHistory.points_at_risk_on_cancel > 0) ? (
                    <div className="flex flex-wrap gap-1.5">
                      {caseHistory.reinstatement_eligible ? (
                        <StatusBadge tone="amber">
                          Reinstatement window open until{" "}
                          {caseHistory.reinstatement_deadline || "31 Dec"}
                        </StatusBadge>
                      ) : null}
                      {caseHistory.requires_guardian_approval ? (
                        <StatusBadge tone="cobalt">
                          Parent/guardian required for profile edits
                        </StatusBadge>
                      ) : null}
                      {typeof caseHistory.points_at_risk_on_cancel === "number" &&
                      caseHistory.points_at_risk_on_cancel > 0 ? (
                        <StatusBadge tone="neutral">
                          Points forfeited on cancel: {caseHistory.points_at_risk_on_cancel}
                        </StatusBadge>
                      ) : null}
                    </div>
                  ) : null}

                  {caseHistory.related_tickets && caseHistory.related_tickets.length > 1 ? (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-600">
                        Related Tickets from Member ({caseHistory.related_tickets.length})
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {caseHistory.related_tickets.map((rt) => {
                          const isCurrent = rt.ticket_id === entry.ticket_id;
                          return isCurrent ? (
                            <span
                              key={rt.ticket_id}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-200/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700"
                            >
                              {rt.ticket_id} (current)
                            </span>
                          ) : (
                            <button
                              key={rt.ticket_id}
                              type="button"
                              onClick={() => onSelectTicket?.(rt.ticket_id)}
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 hover:bg-blue-100"
                            >
                              <span className="font-mono font-semibold">{rt.ticket_id}</span>
                              <span className="truncate max-w-[140px]">{rt.subject}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {caseHistory.cases.length > 0 ? (
                    <ul className="space-y-1">
                      {caseHistory.cases.map((c) => (
                        <li
                          key={c.case_id}
                          className="rounded border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-[11px] text-emerald-950"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold">{c.category}</span>
                            <span className="font-mono text-[10px]">{c.case_id.slice(0, 8)}</span>
                          </div>
                          {c.summary ? (
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-emerald-900">
                              {c.summary}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      No prior approved cases recorded for {caseHistory.member_id}.
                    </p>
                  )}
                </div>
              </section>
            ) : null}

            {/* Fixture & Match Ticket Lookup */}
            {memberMatched && fixtureLookup?.status === "matched" ? (
              <section aria-label="Fixture and match ticket lookup">
                <div className="mb-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Fixture &amp; Match Ticket</span>
                  </h3>
                </div>

                {fixtureLookup.tickets.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-500">
                    No upcoming fixture tickets on file for {fixtureLookup.member_id}.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fixtureLookup.tickets.map((ft) => (
                      <div
                        key={`${ft.fixture_id}-${ft.seating_block}`}
                        className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 pb-2">
                          <div>
                            <div className="font-semibold text-slate-900">
                              vs {ft.opponent}
                            </div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {ft.fixture_id} - {formatTimestamp(ft.kickoff)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <StatusBadge tone="navy">{ft.fixture_category}</StatusBadge>
                            <StatusBadge
                              tone={
                                ft.match_status.toLowerCase() === "scheduled"
                                  ? "emerald"
                                  : "crimson"
                              }
                            >
                              {ft.match_status}
                            </StatusBadge>
                          </div>
                        </div>

                        <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5">
                          <dt className="text-slate-500">Ticket Type</dt>
                          <dd className="font-medium text-slate-900">{ft.ticket_type}</dd>

                          <dt className="text-slate-500">Seating Block</dt>
                          <dd className="font-mono text-[11px] text-slate-800">
                            {ft.seating_block}
                          </dd>

                          <dt className="text-slate-500">Ticket Exchange</dt>
                          <dd className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge
                              tone={
                                ft.exchange_eligible && !ft.within_exchange_cutoff
                                  ? "emerald"
                                  : ft.exchange_eligible
                                    ? "crimson"
                                    : "neutral"
                              }
                            >
                              {ft.exchange_eligible
                                ? ft.within_exchange_cutoff
                                  ? "Cutoff Passed"
                                  : "Eligible"
                                : "Not Eligible"}
                            </StatusBadge>
                            <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                              {ft.hours_until_kickoff}h to KO (cutoff {ft.exchange_cutoff_hours}h)
                            </span>
                          </dd>

                          {ft.adult_upgrade_differential_gbp > 0 ? (
                            <>
                              <dt className="text-slate-500">Upgrade Diff</dt>
                              <dd className="font-mono text-[11px] font-semibold text-amber-900 tabular-nums">
                                £{ft.adult_upgrade_differential_gbp.toFixed(2)}
                              </dd>
                            </>
                          ) : null}
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* Recent Billing Ledger */}
            {memberMatched && recentTransactions?.status === "matched" ? (
              <section aria-label="Recent billing ledger">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    <CreditCard className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Recent Billing Ledger</span>
                  </h3>
                  {recentTransactions.has_duplicate_pending ? (
                    <StatusBadge tone="crimson">
                      Duplicate Pending (£{recentTransactions.pending_total_gbp.toFixed(2)})
                    </StatusBadge>
                  ) : null}
                </div>

                {recentTransactions.transactions.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-500">
                    No recent billing transactions recorded for {recentTransactions.member_id}.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {recentTransactions.transactions.map((tx) => {
                      const statusLower = tx.status.toLowerCase();
                      const tone =
                        statusLower.includes("pending") || statusLower.includes("duplicate")
                          ? "crimson"
                          : statusLower === "settled"
                            ? "emerald"
                            : "neutral";
                      return (
                        <li
                          key={tx.transaction_id}
                          className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">{tx.description}</div>
                              <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                                {tx.transaction_id} - {tx.payment_method} -{" "}
                                {formatTimestamp(tx.timestamp)}
                              </div>
                            </div>
                            <span className="shrink-0 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              £{tx.amount_gbp.toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <StatusBadge tone={tone}>{tx.status}</StatusBadge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : null}

            {/* KB Grounding Section */}
            <section aria-label="Approved knowledge base articles">
              <div className="mb-2">
                <h3 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  Knowledge Base
                </h3>
              </div>

              {prioritisedKbIds.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  No KB articles were cited or matched for this ticket. Avoid stating club prices,
                  deadlines, or policy rules without staff verification.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {prioritisedKbIds.map((id) => {
                    const isCited = citedIds.includes(id);
                    const isHighlighted = highlightedArticleId === id;
                    const content = kbArticles[id];
                    const similarity = searchScores[id];
                    return (
                      <article
                        key={id}
                        className={`rounded-md border p-3 text-xs transition-colors ${
                          isHighlighted
                            ? "border-blue-500 bg-blue-50/40"
                            : isCited
                              ? "border-emerald-200 bg-emerald-50/30"
                              : "border-slate-200 bg-slate-50/60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <BookOpen className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                            <span>{formatKbArticleTitle(id, content)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {typeof similarity === "number" ? (
                              <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                                sim {similarity.toFixed(2)}
                              </span>
                            ) : null}
                            {isCited ? (
                              <StatusBadge tone="emerald">Cited</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">Retrieved</StatusBadge>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed text-slate-700">
                          {renderKbBody(content)}
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}

              {remainingKbIds.length > 0 ? (
                <div className="mt-3">
                  <button
                    type="button"
                    aria-expanded={showFullCorpus}
                    onClick={() => setShowFullCorpus((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 transition-transform ${
                        showFullCorpus ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      {showFullCorpus ? "Hide" : "Browse"} other approved KB articles (
                      {remainingKbIds.length})
                    </span>
                  </button>

                  {showFullCorpus ? (
                    <div className="mt-2 space-y-2">
                      {remainingKbIds.map((id) => (
                        <article
                          key={id}
                          className="rounded-md border border-slate-200 bg-white p-2.5 text-xs"
                        >
                          <div className="font-semibold text-slate-900">
                            {formatKbArticleTitle(id, kbArticles[id])}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-600">
                            {renderKbBody(kbArticles[id])}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {/* TAB 2: ENGINE TELEMETRY & COMPARISON */}
        {activeTab === "telemetry" ? (
          <div
            role="tabpanel"
            id="inspector-panel-telemetry"
            aria-labelledby="inspector-tab-telemetry"
            className="space-y-4"
          >
            {/* Side-by-side comparison / trigger */}
            <section
              aria-label="Engine comparison"
              className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  Jev vs. Claude Comparison
                </span>
                <button
                  type="button"
                  disabled={isTriaging}
                  onClick={() => onRunComparisonEngine(entry.ticket_id, alternateEngine)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                  <span>
                    Run {alternateEngine === "claude" ? "Claude (Sys-2)" : "Jev (Sys-1)"}
                  </span>
                </button>
              </div>

              {jevResult && claudeResult ? (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {[
                    { title: "Jev (System 1)", res: jevResult },
                    { title: "Claude (System 2)", res: claudeResult },
                  ].map(({ title, res }) => (
                    <div
                      key={title}
                      className="rounded border border-slate-200 bg-white p-2 text-[11px]"
                    >
                      <div className="font-semibold text-slate-900">{title}</div>
                      {res.error ? (
                        <div className="mt-1 text-red-700">{res.error}</div>
                      ) : res.agent ? (
                        <dl className="mt-1 space-y-1">
                          <div>
                            <dt className="text-slate-500">Action</dt>
                            <dd className="font-mono font-semibold text-slate-900">
                              {res.agent.action}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Intent</dt>
                            <dd className="text-slate-700">{formatIntent(res.agent.intent)}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Latency</dt>
                            <dd className="font-mono text-slate-700 tabular-nums">
                              {(res.system_one?.latency_ms ?? res.latency_ms ?? 0).toFixed(0)} ms
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Run both Jev and Claude on {entry.ticket_id} during this session to compare
                  actions, grounding, and latency side-by-side.
                </p>
              )}
            </section>

            {/* Detailed telemetry for currently displayed result */}
            {!displayedResult ? (
              <p className="text-xs text-slate-500">No model telemetry recorded yet.</p>
            ) : displayedResult.engine === "claude" ? (
              <div className="rounded-md border border-slate-200 bg-white p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <Cpu className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                  <span>Claude System-2 Run Details</span>
                </div>
                <dl className="mt-2 grid grid-cols-[100px_1fr] gap-y-1.5">
                  <dt className="text-slate-500">Provider</dt>
                  <dd className="font-mono text-[11px]">{displayedResult.provider || "claude"}</dd>
                  <dt className="text-slate-500">Model</dt>
                  <dd className="font-mono text-[11px]">{displayedResult.model || "-"}</dd>
                  <dt className="text-slate-500">Latency</dt>
                  <dd className="font-mono text-[11px] tabular-nums">
                    {displayedResult.latency_ms != null
                      ? `${displayedResult.latency_ms.toFixed(0)} ms`
                      : "-"}
                  </dd>
                  <dt className="text-slate-500">Tool Turns</dt>
                  <dd className="font-mono text-[11px] tabular-nums">
                    {displayedResult.turns ?? "-"}
                  </dd>
                  <dt className="text-slate-500">Tokens</dt>
                  <dd className="font-mono text-[11px] tabular-nums">
                    {displayedResult.usage
                      ? `${displayedResult.usage.input_tokens ?? 0} in / ${
                          displayedResult.usage.output_tokens ?? 0
                        } out`
                      : "-"}
                  </dd>
                </dl>
              </div>
            ) : displayedResult.system_one ? (
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 bg-white p-3 text-xs">
                  <div className="font-semibold text-slate-900">
                    {displayedResult.system_one.model}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-slate-600 tabular-nums">
                    <span>Latency: {displayedResult.system_one.latency_ms.toFixed(1)} ms</span>
                    <span>
                      Tokens: {displayedResult.system_one.usage?.input_tokens ?? 0} in /{" "}
                      {displayedResult.system_one.usage?.output_tokens ?? 0} out
                    </span>
                  </div>
                  {displayedResult.system_one.fallback_reason ? (
                    <p className="mt-1.5 text-[11px] text-amber-800">
                      API fallback: {displayedResult.system_one.fallback_reason}
                    </p>
                  ) : null}
                </div>

                {/* Safety Gates */}
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    Safety &amp; Grounding Gates
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(displayedResult.system_one.nouls || {}).map(([name, n]) => {
                      const pct = Math.round(n.noul * 100);
                      const isInjection = name === "prompt_injection_risk";
                      const good = isInjection ? n.noul < 0.5 : n.noul >= 0.7;
                      return (
                        <div
                          key={name}
                          className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-2 text-xs"
                        >
                          <div className="flex items-center gap-1.5">
                            {good ? (
                              <ShieldCheck
                                className="h-3.5 w-3.5 text-emerald-700"
                                aria-hidden="true"
                              />
                            ) : (
                              <AlertCircle
                                className="h-3.5 w-3.5 text-red-700"
                                aria-hidden="true"
                              />
                            )}
                            <code className="font-mono text-[11px] text-slate-800">{name}</code>
                          </div>
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums ${
                              good ? "text-emerald-800" : "text-red-800"
                            }`}
                          >
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Choice Probability Distributions */}
                {Object.entries(displayedResult.system_one.choices || {}).map(([name, choice]) => (
                  <div key={name} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Choice: <code className="font-mono">{name}</code>
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-blue-800 tabular-nums">
                        {choice.choice} ({Math.round(choice.confidence * 100)}%)
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {Object.entries(choice.probabilities || {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([opt, prob]) => (
                          <div
                            key={opt}
                            className="grid grid-cols-[minmax(0,1fr)_72px_38px] items-center gap-2 text-[11px]"
                          >
                            <span className="truncate font-mono text-slate-700" title={opt}>
                              {opt}
                            </span>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${
                                  opt === choice.choice ? "bg-blue-700" : "bg-slate-300"
                                }`}
                                style={{ width: `${Math.max(0, Math.min(100, prob * 100))}%` }}
                              />
                            </div>
                            <span className="text-right font-mono text-slate-600 tabular-nums">
                              {(prob * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}

                {/* Score Distributions (Urgency) */}
                {Object.entries(displayedResult.system_one.scores || {}).map(([name, sc]) => (
                  <div key={name} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Score: <code className="font-mono">{name}</code>
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-amber-800 tabular-nums">
                        {formatUrgencyOrdinal(sc)?.display ?? sc.score}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {Object.entries(sc.probabilities || {}).map(([lvl, prob]) => (
                        <div key={lvl} className="space-y-0.5 text-[11px]">
                          <div className="flex justify-between text-slate-600">
                            <span className="truncate">
                              {lvl}: {sc.legend?.[lvl] || ""}
                            </span>
                            <span className="font-mono tabular-nums">
                              {(prob * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-amber-600"
                              style={{ width: `${Math.max(0, Math.min(100, prob * 100))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* TAB 3: SQLITE MCP & STAFF AUDIT TRACE */}
        {activeTab === "trace" ? (
          <div
            role="tabpanel"
            id="inspector-panel-trace"
            aria-labelledby="inspector-tab-trace"
            className="space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                Activity Log
              </h3>
              <button
                type="button"
                onClick={() => onReloadTrace(entry.ticket_id)}
                className="text-[11px] font-medium text-blue-700 hover:underline"
              >
                Refresh
              </button>
            </div>

            {isLoadingTrace ? (
              <p className="text-xs text-slate-500">Loading audit events…</p>
            ) : traceError ? (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                {traceError}
              </div>
            ) : activeTrace.length === 0 ? (
              <p className="text-xs text-slate-500">
                No MCP tool calls or staff decisions recorded yet for {entry.ticket_id}.
              </p>
            ) : (
              <ol className="space-y-2">
                {activeTrace.map((ev) => {
                  const isHumanEvent =
                    ev.event === "approval" ||
                    ev.event === "rejection" ||
                    ev.event === "staff_action";
                  return (
                    <li
                      key={ev.id}
                      className={`rounded-md border p-2.5 text-xs ${
                        isHumanEvent
                          ? "border-emerald-200 bg-emerald-50/40"
                          : "border-slate-200 bg-slate-50/60"
                      }`}
                    >
                      <details>
                        <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium text-slate-900">
                          <span className="flex items-center gap-1.5">
                            {isHumanEvent ? (
                              <CheckCircle2
                                className="h-3.5 w-3.5 text-emerald-700"
                                aria-hidden="true"
                              />
                            ) : null}
                            <code className="font-mono text-[11px] font-semibold">
                              {ev.event}
                            </code>
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {formatTimestamp(ev.at)}
                          </span>
                        </summary>
                        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                          <div>
                            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                              Inputs
                            </div>
                            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                              {safePrettyJson(ev.inputs)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                              Result
                            </div>
                            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                              {safePrettyJson(ev.result)}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
