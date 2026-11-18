import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Mail,
  Play,
  RotateCcw,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  UserX,
} from "lucide-react";
import type {
  EngineType,
  EnrichedTicket,
  StaffActionPayload,
  TriageResult,
} from "../../types/triage";
import {
  cleanRationale,
  deriveRiskSignals,
  formatEmailReceivedAt,
  formatIntent,
  formatUrgencyOrdinal,
  getActionMeta,
} from "../../utils/triageDisplay";
import { StatusBadge } from "../../components/StatusBadge";
import { CaseProposalCard } from "./CaseProposalCard";
import { StaffActionBar } from "./StaffActionBar";

interface TicketWorkspacePaneProps {
  entry: EnrichedTicket | null;
  displayedResult: TriageResult | null;
  selectedEngine: EngineType;
  draftReply: string;
  isTriaging: boolean;
  triageError: string | null;
  isSubmittingAction: boolean;
  actionError: string | null;
  hasNextPending: boolean;
  queuePosition: { index: number; total: number } | null;
  prevTicketId: string | null;
  nextTicketId: string | null;
  canGoNext: boolean;
  onSelectTicket: (ticketId: string) => void;
  onNextTicket: () => void;
  onDraftReplyChange: (ticketId: string, value: string) => void;
  onResetDraftReply: (ticketId: string) => void;
  onRunTriage: (ticketId: string, engine?: EngineType) => void;
  onSubmitAction: (
    ticketId: string,
    payload: StaffActionPayload,
    options?: { advanceToNextPending?: boolean }
  ) => Promise<boolean>;
  onOpenOverride: () => void;
  onInspectCitation: (articleId: string) => void;
}

export function TicketWorkspacePane({
  entry,
  displayedResult,
  selectedEngine,
  draftReply,
  isTriaging,
  triageError,
  isSubmittingAction,
  actionError,
  hasNextPending,
  queuePosition,
  prevTicketId,
  nextTicketId,
  canGoNext,
  onSelectTicket,
  onNextTicket,
  onDraftReplyChange,
  onResetDraftReply,
  onRunTriage,
  onSubmitAction,
  onOpenOverride,
  onInspectCitation,
}: TicketWorkspacePaneProps) {
  const [confirmingCaseCreation, setConfirmingCaseCreation] = useState(false);

  const activePreviewId =
    displayedResult?.agent?.case_preview?.status === "preview"
      ? (displayedResult.agent.case_preview.preview_id ?? null)
      : null;

  useEffect(() => {
    setConfirmingCaseCreation(false);
  }, [entry?.ticket_id, activePreviewId]);

  if (!entry) {
    return (
      <section
        aria-label="Ticket workspace"
        className="flex h-full items-center justify-center bg-slate-50 p-8 text-center"
      >
        <div className="max-w-sm">
          <Mail className="mx-auto h-7 w-7 text-slate-400" aria-hidden="true" />
          <h2 className="mt-2 text-sm font-semibold text-slate-900">Select a ticket to review</h2>
          <p className="mt-1 text-xs text-slate-500">
            Choose an inbound member enquiry from the queue to review its verified member record,
            approved KB evidence, and recommended action.
          </p>
        </div>
      </section>
    );
  }

  const { ticket, staff_action: staff } = entry;
  const agent = displayedResult?.agent ?? null;
  const sys1 = displayedResult?.system_one ?? null;
  const effectiveError = triageError || displayedResult?.error || null;

  const memberMatched = agent?.member?.status === "matched";
  const verifiedSenderName = memberMatched
    ? agent?.member?.name || entry.matched_member?.name || null
    : null;
  const receivedAtLabel = formatEmailReceivedAt(entry.ticket_id, ticket.received_at);
  const riskSignals = deriveRiskSignals(entry, displayedResult);
  const actionMeta = getActionMeta(agent?.action);

  const actionConf = sys1?.choices?.action?.confidence;
  const rawConfidence =
    displayedResult?.engine === "jev" && typeof actionConf === "number"
      ? actionConf
      : typeof agent?.confidence === "number"
        ? agent.confidence
        : null;
  const confidenceDisplay =
    typeof rawConfidence === "number" ? `${Math.round(rawConfidence * 100)}%` : "-";
  const urgencyOrdinal = formatUrgencyOrdinal(sys1?.scores?.urgency);
  const engineMismatch = Boolean(
    displayedResult && displayedResult.engine !== selectedEngine
  );

  const originalDraft = staff?.reply_text || agent?.draft_reply || "";
  const isDraftDirty = Boolean(agent && draftReply !== originalDraft);

  const selectedEngineLabel = selectedEngine === "jev" ? "Jev" : "Claude";

  const handleThumbsUp = async () => {
    if (!agent || !displayedResult) return;
    if (
      agent.action === "create_case" &&
      activePreviewId &&
      (!staff || staff.decision_type === "reject_case")
    ) {
      setConfirmingCaseCreation(true);
      return;
    }
    await onSubmitAction(entry.ticket_id, {
      recommended_action: agent.action,
      final_action: agent.action,
      decision_type: "accept",
      reply_text: draftReply,
      notes: `Thumbs-up feedback: accepted ${displayedResult.engine} recommendation`,
      preview_id: activePreviewId,
      engine: displayedResult.engine,
    });
  };

  return (
    <section
      aria-label="Ticket decision workspace"
      className="flex h-full min-h-0 flex-col bg-slate-50"
    >
      {/* Compact Workspace Toolbar */}
      <div className="border-b border-slate-200 bg-white px-5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="navy" className="font-mono">
              {entry.ticket_id}
            </StatusBadge>

            {agent ? (
              memberMatched ? (
                <StatusBadge tone="emerald" icon={<UserCheck className="h-3 w-3" />}>
                  Verified: {agent.member.member_id}
                  {agent.member.name ? ` - ${agent.member.name}` : ""}
                  {agent.member.tier ? ` (${agent.member.tier})` : ""}
                </StatusBadge>
              ) : (
                <StatusBadge tone="crimson" icon={<UserX className="h-3 w-3" />}>
                  Identity Unverified
                </StatusBadge>
              )
            ) : (
              <StatusBadge tone="neutral">Awaiting Lookup</StatusBadge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {queuePosition ? (
              <div className="inline-flex items-center rounded-md border border-slate-300 bg-white text-xs">
                <button
                  type="button"
                  disabled={!prevTicketId}
                  onClick={() => prevTicketId && onSelectTicket(prevTicketId)}
                  aria-label="Previous ticket"
                  className="rounded-l-md px-1.5 py-1.5 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span className="border-x border-slate-200 px-2 py-1 font-mono text-[11px] text-slate-600 tabular-nums">
                  {queuePosition.index + 1}/{queuePosition.total}
                </span>
                <button
                  type="button"
                  disabled={!nextTicketId}
                  onClick={() => nextTicketId && onSelectTicket(nextTicketId)}
                  aria-label="Next ticket"
                  className="rounded-r-md px-1.5 py-1.5 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            <button
              type="button"
              disabled={isTriaging}
              onClick={() => onRunTriage(entry.ticket_id, selectedEngine)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              {isTriaging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
              )}
              <span>
                {isTriaging
                  ? `Running ${selectedEngineLabel}…`
                  : displayedResult
                    ? `Re-run with ${selectedEngineLabel}`
                    : `Run ${selectedEngineLabel}`}
              </span>
            </button>
          </div>
        </div>

        {/* Engine switch alignment notice */}
        {engineMismatch && !isTriaging ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-xs text-blue-950">
            <span>
              Showing saved result from{" "}
              <strong>{displayedResult?.engine === "jev" ? "Jev (System 1)" : "Claude (System 2)"}</strong>
              . Active selector is <strong>{selectedEngineLabel}</strong>.
            </span>
            <button
              type="button"
              onClick={() => onRunTriage(entry.ticket_id, selectedEngine)}
              className="font-semibold text-blue-800 underline underline-offset-2 hover:text-blue-950"
            >
              Run {selectedEngineLabel} to compare
            </button>
          </div>
        ) : null}
      </div>

      {/* Scrollable Workspace Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-2xs">
          {/* 1. Inbound Member Email (Authentic email layout) */}
          <section aria-label="Inbound member email" className="p-4">
            <h3 className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              Inbound Member Email
            </h3>

            <div className="mt-2.5 overflow-hidden rounded-md border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    {ticket.subject || "(No subject)"}
                  </h2>
                  <time
                    dateTime={ticket.received_at}
                    className="shrink-0 font-mono text-xs text-slate-500 tabular-nums"
                  >
                    {receivedAtLabel}
                  </time>
                </div>

                <dl className="mt-2 grid grid-cols-[44px_1fr] gap-x-2 gap-y-0.5 text-xs">
                  <dt className="font-medium text-slate-500">From:</dt>
                  <dd className="min-w-0 truncate text-slate-800">
                    {verifiedSenderName ? (
                      <>
                        <span className="font-medium">{verifiedSenderName}</span>{" "}
                        <span className="font-mono text-slate-600">
                          &lt;{ticket.from_email || ticket.from}&gt;
                        </span>
                      </>
                    ) : (
                      <span className="font-mono">{ticket.from_email || ticket.from}</span>
                    )}
                  </dd>
                  <dt className="font-medium text-slate-500">To:</dt>
                  <dd className="min-w-0 truncate text-slate-700">
                    Northbank FC Member Services{" "}
                    <span className="font-mono text-slate-500">
                      &lt;support@northbankfc.co.uk&gt;
                    </span>
                  </dd>
                  <dt className="font-medium text-slate-500">Date:</dt>
                  <dd className="font-mono text-slate-600 tabular-nums">{receivedAtLabel}</dd>
                </dl>
              </div>

              <div className="bg-white px-4 py-3.5">
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-900">
                  {ticket.body || "(Empty message body)"}
                </p>
              </div>
            </div>
          </section>

          {/* Triage Error State */}
          {effectiveError ? (
            <div role="alert" className="bg-red-50/70 p-4 text-xs text-red-950">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-red-900">
                      Triage engine returned an error - no changes made
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-red-800 break-words">
                      {effectiveError}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isTriaging}
                  onClick={() => onRunTriage(entry.ticket_id, selectedEngine)}
                  className="shrink-0 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
                >
                  Retry ({selectedEngineLabel})
                </button>
              </div>
            </div>
          ) : null}

          {/* Loading skeleton when running triage on an untriaged ticket */}
          {isTriaging && !agent ? (
            <div
              aria-busy="true"
              aria-label="Generating recommendation"
              className="space-y-3 p-4"
            >
              <div className="h-3 w-36 animate-pulse rounded bg-slate-200" />
              <div className="h-5 w-64 animate-pulse rounded bg-slate-200" />
              <div className="h-14 w-full animate-pulse rounded bg-slate-100" />
            </div>
          ) : null}

          {/* Untriaged State */}
          {!displayedResult && !isTriaging && !effectiveError ? (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-slate-800">
                This ticket has not been triaged yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Run {selectedEngineLabel} to perform exact member lookup, search approved KB
                articles, and generate a reviewable recommendation.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onRunTriage(entry.ticket_id, selectedEngine)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Run {selectedEngineLabel} Triage</span>
                </button>
                {canGoNext ? (
                  <button
                    type="button"
                    onClick={onNextTicket}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <span>Skip / Next Ticket</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* 2. Recommendation & 3. Response */}
          {agent && !effectiveError ? (
            <>
              <section aria-label="Recommendation" className="p-4">
                {/* 4-column Recommendation summary table */}
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full border-collapse text-left">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                        <th scope="col" className="px-3.5 py-2">
                          Recommendation
                        </th>
                        <th scope="col" className="px-3.5 py-2">
                          Type
                        </th>
                        <th scope="col" className="px-3.5 py-2">
                          Urgency
                        </th>
                        <th scope="col" className="px-3.5 py-2 text-right">
                          Confidence
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white text-xs text-slate-900">
                      <tr>
                        <td className="px-3.5 py-2.5">
                          <StatusBadge tone={actionMeta.tone} className="px-2 py-0.5 text-xs">
                            {actionMeta.label}
                          </StatusBadge>
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-slate-900">
                          {formatIntent(agent.intent)}
                        </td>
                        <td className="px-3.5 py-2.5">
                          {urgencyOrdinal ? (
                            <StatusBadge
                              tone={
                                urgencyOrdinal.level >= 3
                                  ? "crimson"
                                  : urgencyOrdinal.level >= 2
                                    ? "amber"
                                    : "neutral"
                              }
                              className="px-2 py-0.5 text-xs"
                            >
                              {urgencyOrdinal.shortLabel}
                            </StatusBadge>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-slate-800 tabular-nums">
                          {confidenceDisplay}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Risk & Uncertainty Gates */}
                {riskSignals.length > 0 ? (
                  <div className="mt-3 space-y-2" aria-label="Risk and uncertainty checks">
                    {riskSignals.map((sig) => (
                      <div
                        key={sig.id}
                        className={`flex items-start gap-2 rounded border px-3 py-2 text-xs ${
                          sig.severity === "critical"
                            ? "border-red-200 bg-red-50/70 text-red-950"
                            : sig.severity === "warning"
                              ? "border-amber-200 bg-amber-50/70 text-amber-950"
                              : "border-slate-200 bg-slate-50 text-slate-800"
                        }`}
                      >
                        {sig.severity === "critical" ? (
                          <ShieldAlert
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700"
                            aria-hidden="true"
                          />
                        ) : sig.severity === "warning" ? (
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700"
                            aria-hidden="true"
                          />
                        ) : (
                          <Info
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600"
                            aria-hidden="true"
                          />
                        )}
                        <div>
                          <span className="font-semibold">{sig.title}:</span>{" "}
                          <span className="text-slate-700">{sig.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Rationale (never repeats confidence percentage shown in table) */}
                <p className="mt-3 text-sm leading-relaxed text-slate-700">
                  {cleanRationale(agent.rationale) || "No rationale provided."}
                </p>

                {/* Cited KB chips + Optional feedback controls */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  {agent.citations.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-slate-500">
                        Policy Reference:
                      </span>
                      {agent.citations.map((cid) => (
                        <button
                          key={cid}
                          type="button"
                          onClick={() => onInspectCitation(cid)}
                          className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-medium text-blue-800 transition-colors hover:bg-blue-100"
                        >
                          <BookOpen className="h-3 w-3" aria-hidden="true" />
                          <span>{cid}.md</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div />
                  )}

                  {/* Optional, subtle feedback controls */}
                  <div
                    role="group"
                    aria-label="Recommendation feedback"
                    className="inline-flex items-center gap-1 text-[11px]"
                  >
                    <span className="mr-1 hidden text-slate-400 sm:inline">Optional:</span>
                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      aria-pressed={staff?.decision_type === "accept"}
                      aria-label="Thumbs up: recommendation is helpful"
                      title="Accept recommendation (thumbs up)"
                      onClick={() => void handleThumbsUp()}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors disabled:opacity-60 ${
                        staff?.decision_type === "accept"
                          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                      <span>Helpful</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingAction}
                      aria-pressed={
                        staff?.decision_type === "override" ||
                        staff?.decision_type === "reject_case"
                      }
                      aria-label="Thumbs down: wrong recommendation"
                      title="Flag wrong recommendation and override (thumbs down)"
                      onClick={onOpenOverride}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors disabled:opacity-60 ${
                        staff?.decision_type === "override" ||
                        staff?.decision_type === "reject_case"
                          ? "bg-red-50 text-red-800 ring-1 ring-red-200"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                      <span>Wrong</span>
                    </button>
                  </div>
                </div>

                {/* Conditional Case Proposal Preview */}
                {agent.action === "create_case" && agent.case_preview ? (
                  <div className="mt-3.5">
                    <CaseProposalCard preview={agent.case_preview} staffAction={staff} />
                  </div>
                ) : null}
              </section>

              {/* 3. Response (Draft Reply + Staff Action Controls) */}
              <section aria-label="Response" className="p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="workspace-draft-reply"
                    className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase"
                  >
                    Response
                  </label>
                  {isDraftDirty ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-amber-800">Edited</span>
                      <button
                        type="button"
                        onClick={() => onResetDraftReply(entry.ticket_id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        <span>Restore draft</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <textarea
                  id="workspace-draft-reply"
                  rows={5}
                  value={draftReply}
                  onChange={(e) => onDraftReplyChange(entry.ticket_id, e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 focus:border-blue-600"
                />

                <StaffActionBar
                  entry={entry}
                  displayedResult={displayedResult!}
                  draftReply={draftReply}
                  isSubmitting={isSubmittingAction}
                  actionError={actionError}
                  hasNextPending={hasNextPending}
                  canGoNext={canGoNext}
                  confirmingCaseCreation={confirmingCaseCreation}
                  onConfirmingCaseCreationChange={setConfirmingCaseCreation}
                  onSubmitAction={onSubmitAction}
                  onOpenOverride={onOpenOverride}
                  onNextTicket={onNextTicket}
                />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
