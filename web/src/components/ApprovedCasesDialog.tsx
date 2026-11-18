import { FolderCheck, X } from "lucide-react";
import type { ApprovedCaseRecord } from "../types/triage";
import { formatCaseCategory, formatTimestamp } from "../utils/triageDisplay";
import { NativeDialog } from "./NativeDialog";

interface ApprovedCasesDialogProps {
  open: boolean;
  cases: ApprovedCaseRecord[];
  onClose: () => void;
}

export function ApprovedCasesDialog({ open, cases, onClose }: ApprovedCasesDialogProps) {
  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      labelledBy="approved-cases-title"
      maxWidthClass="max-w-3xl"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <FolderCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            <h2 id="approved-cases-title" className="text-base font-semibold text-slate-900">
              Approved Cases
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close approved cases dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">
          {cases.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-xs text-slate-500">
              No cases have been approved yet. Pending <code className="font-mono">create_case</code>{" "}
              proposals remain preview-only until confirmed by staff.
            </div>
          ) : (
            <div tabIndex={0} role="region" aria-labelledby="cases-table-caption" className="table-wrapper">
              <table>
                <caption id="cases-table-caption" className="visually-hidden">
                  Staff-approved Member Services cases persisted in SQLite
                </caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                    <th scope="col" className="px-3 py-2">
                      Member
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Category
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Summary
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Case ID
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Approved
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {cases.map((c) => (
                    <tr key={c.case_id}>
                      <th scope="row" className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-900">
                        {c.member_id}
                      </th>
                      <td data-label="Category" className="px-3 py-2.5 text-xs text-slate-800">
                        {formatCaseCategory(c.category)}
                      </td>
                      <td data-label="Summary" className="px-3 py-2.5 text-xs text-slate-700">
                        {c.summary}
                      </td>
                      <td
                        data-label="Case ID"
                        className="px-3 py-2.5 font-mono text-[11px] text-slate-500"
                      >
                        {c.case_id.slice(0, 8)}…
                      </td>
                      <td
                        data-label="Approved"
                        className="px-3 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap"
                      >
                        {formatTimestamp(c.approved_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </NativeDialog>
  );
}
