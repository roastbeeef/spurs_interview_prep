import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Edit3,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type {
  EnrichedTicket,
  StaffActionPayload,
  TriageResult,
} from "../../types/triage";
import {
  formatCaseCategory,
  formatTimestamp,
  getActionMeta,
} from "../../utils/triageDisplay";

interface StaffActionBarProps {
  entry: EnrichedTicket;
  displayedResult: TriageResult;
  draftReply: string;
  isSubmitting: boolean;
  actionError: string | null;
  hasNextPending: boolean;
  canGoNext: boolean;
  confirmingCaseCreation: boolean;
  onConfirmingCaseCreationChange: (confirming: boolean) => void;
  onSubmitAction: (
    ticketId: string,
    payload: StaffActionPayload,
    options?: { advanceToNextPending?: boolean }
  ) => Promise<boolean>;
  onOpenOverride: () => void;
  onNextTicket: () => void;
}

export function StaffActionBar({
  entry,
  displayedResult,
  draftReply,
  isSubmitting,
  actionError,
  hasNextPending,
  canGoNext,
  confirmingCaseCreation,
  onConfirmingCaseCreationChange,
  onSubmitAction,
  onOpenOverride,
  onNextTicket,
}: StaffActionBarProps) {
  const agent = displayedResult.agent;
  if (!agent) return null;

  const recAction = agent.action;
  const actionMeta = getActionMeta(recAction);
  const preview = agent.case_preview;
  const previewId =
    preview && preview.status === "preview" && preview.preview_id
      ? preview.preview_id
      : null;
  const staff = entry.staff_action;
  const engineUsed = displayedResult.engine;

  const canAcceptRecommendation = !staff || staff.decision_type === "reject_case";
  const canRejectCase =
    recAction === "create_case" &&
    Boolean(previewId) &&
    (!staff || (staff.decision_type !== "reject_case" && !staff.case_id));

  const buildAcceptPayload = (): StaffActionPayload => ({
    recommended_action: recAction,
    final_action: recAction,
    decision_type: "accept",
    reply_text: draftReply,
    notes: `Accepted ${engineUsed} recommendation`,
    preview_id: previewId,
    engine: engineUsed,
  });

  const handlePrimaryClick = async (advanceToNextPending: boolean) => {
    if (recAction === "create_case" && previewId && !confirmingCaseCreation) {
      onConfirmingCaseCreationChange(true);
      return;
    }
    const ok = await onSubmitAction(entry.ticket_id, buildAcceptPayload(), {
      advanceToNextPending,
    });
    if (ok) {
      onConfirmingCaseCreationChange(false);
    }
  };

  const handleRejectCase = async () => {
    await onSubmitAction(entry.ticket_id, {
      recommended_action: recAction,
      final_action: "rejected",
      decision_type: "reject_case",
      reply_text: draftReply,
      notes: "Staff rejected proposed case",
      preview_id: previewId,
      engine: engineUsed,
    });
  };

  return (
    <div className="pt-3">
      {/* Existing persisted decision banner */}
      {staff ? (
        <div
          className={`mb-3 rounded-md border px-3.5 py-3 text-xs ${
            staff.decision_type === "reject_case"
              ? "border-red-200 bg-red-50 text-red-950"
              : "border-emerald-200 bg-emerald-50 text-emerald-950"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-semibold">
              {staff.decision_type === "reject_case" ? (
                <XCircle className="h-4 w-4 text-red-700" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
              )}
              <span>
                Staff Decision Recorded:{" "}
                <code className="font-mono">{staff.final_action}</code> ({staff.decision_type})
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-600">
              {staff.actor} - {formatTimestamp(staff.acted_at)}
            </span>
          </div>
          {staff.case_id ? (
            <p className="mt-1.5 font-mono text-[11px] text-emerald-900">
              Case ID: <strong>{staff.case_id}</strong>
            </p>
          ) : null}
          {staff.notes ? (
            <p className="mt-1 text-slate-700">
              <span className="font-medium">Notes:</span> {staff.notes}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Inline error display */}
      {actionError ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          <div>
            <div className="font-semibold">Unable to record staff action</div>
            <p className="mt-0.5 text-red-800">{actionError}</p>
          </div>
        </div>
      ) : null}

      {/* Explicit pre-commit confirmation step for case creation */}
      {confirmingCaseCreation && preview ? (
        <div
          role="region"
          aria-label="Confirm case creation"
          className="mb-3 rounded-md border border-amber-300 bg-amber-50/70 p-3.5"
        >
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-semibold text-slate-900">Confirm Case Creation</p>
              <p className="mt-1 text-slate-700">
                Create a support case for member{" "}
                <code className="font-mono font-semibold text-slate-900">
                  {preview.member_id}
                </code>{" "}
                ({formatCaseCategory(preview.category)})?
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handlePrimaryClick(false)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>Confirm &amp; Create Case</span>
                </button>
                {hasNextPending ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handlePrimaryClick(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span>Confirm &amp; Next Pending</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => onConfirmingCaseCreationChange(false)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-amber-100/70 hover:text-slate-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Primary controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!staff && canGoNext && !confirmingCaseCreation ? (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onNextTicket}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <span>Skip / Next Ticket</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {canAcceptRecommendation && !confirmingCaseCreation ? (
            <>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handlePrimaryClick(false)}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{actionMeta.primaryButtonLabel}</span>
              </button>

              {hasNextPending && recAction !== "create_case" ? (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handlePrimaryClick(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                >
                  <span>Approve &amp; Next</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}

          {canRejectCase ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleRejectCase()}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reject Case Proposal</span>
            </button>
          ) : null}

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onOpenOverride}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <Edit3 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>{staff ? "Update / Override…" : "Override Action…"}</span>
          </button>

          {staff && canGoNext ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onNextTicket}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              <span>Next Ticket</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
