import { CheckCircle2, FilePlus2, XCircle } from "lucide-react";
import type { CasePreview, StaffActionRecord } from "../../types/triage";
import { formatCaseCategory, formatTimestamp } from "../../utils/triageDisplay";
import { StatusBadge } from "../../components/StatusBadge";

interface CaseProposalCardProps {
  preview: CasePreview;
  staffAction: StaffActionRecord | null;
}

export function CaseProposalCard({ preview, staffAction }: CaseProposalCardProps) {
  if (preview.status !== "preview") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50/70 p-3.5 text-xs text-red-900">
        <div className="font-semibold">MCP Case Proposal Refused</div>
        <p className="mt-1 text-red-800">{preview.reason || "Proposal failed MCP validation."}</p>
      </div>
    );
  }

  const isCreatedForThisPreview = Boolean(
    staffAction?.case_id && staffAction.preview_id === preview.preview_id
  );
  const isRejectedForThisPreview = Boolean(
    staffAction?.decision_type === "reject_case" && staffAction.preview_id === preview.preview_id
  );

  return (
    <section
      aria-label="Case Proposal"
      className={`rounded-md border p-4 ${
        isCreatedForThisPreview
          ? "border-emerald-300 bg-emerald-50/50"
          : isRejectedForThisPreview
            ? "border-red-200 bg-red-50/40"
            : "border-amber-300 bg-amber-50/40"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
        <div className="flex items-center gap-2">
          <FilePlus2
            className={`h-4 w-4 ${
              isCreatedForThisPreview
                ? "text-emerald-700"
                : isRejectedForThisPreview
                  ? "text-red-700"
                  : "text-amber-700"
            }`}
            aria-hidden="true"
          />
          <h3 className="text-xs font-semibold tracking-wider text-slate-800 uppercase">
            Case Proposal
          </h3>
        </div>

        {isCreatedForThisPreview ? (
          <StatusBadge tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />}>
            Case Created &amp; Persisted
          </StatusBadge>
        ) : isRejectedForThisPreview ? (
          <StatusBadge tone="crimson" icon={<XCircle className="h-3 w-3" />}>
            Proposal Rejected
          </StatusBadge>
        ) : (
          <StatusBadge tone="amber">Preview Only - Not Yet Created</StatusBadge>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-[120px_1fr]">
        <dt className="font-medium text-slate-500">Target Member</dt>
        <dd className="font-mono font-semibold text-slate-900">{preview.member_id || "-"}</dd>

        <dt className="font-medium text-slate-500">Case Category</dt>
        <dd className="font-medium text-slate-900">
          {formatCaseCategory(preview.category)}{" "}
          <span className="font-mono text-[11px] font-normal text-slate-500">
            ({preview.category})
          </span>
        </dd>

        <dt className="font-medium text-slate-500">Preview ID</dt>
        <dd className="font-mono text-[11px] text-slate-600 break-all">
          {preview.preview_id || "-"}
        </dd>

        {isCreatedForThisPreview && staffAction?.case_id ? (
          <>
            <dt className="font-medium text-emerald-800">Case ID</dt>
            <dd className="font-mono text-[11px] font-semibold text-emerald-900 break-all">
              {staffAction.case_id} - Approved {formatTimestamp(staffAction.acted_at)}
            </dd>
          </>
        ) : null}

        <dt className="font-medium text-slate-500">Case Summary</dt>
        <dd className="text-slate-800 leading-relaxed">{preview.summary || "-"}</dd>
      </dl>
    </section>
  );
}
