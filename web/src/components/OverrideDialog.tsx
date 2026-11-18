import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { EnrichedTicket, StaffActionPayload, TriageAction, TriageResult } from "../types/triage";
import { NativeDialog } from "./NativeDialog";

interface OverrideDialogProps {
  open: boolean;
  entry: EnrichedTicket | null;
  displayedResult: TriageResult | null;
  draftReply: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmitOverride: (ticketId: string, payload: StaffActionPayload) => Promise<boolean>;
}

const ACTION_OPTIONS: Array<{ value: TriageAction; label: string; help: string }> = [
  {
    value: "resolve",
    label: "Send Grounded Reply",
    help: "Close ticket with an approved knowledge-base reply; no case created.",
  },
  {
    value: "create_case",
    label: "Mark for Support Case",
    help: "Designate this request for Member Services case handling.",
  },
  {
    value: "escalate_to_human",
    label: "Escalate to Specialist",
    help: "Route to billing, safety, or senior Member Services specialist.",
  },
  {
    value: "ask_clarification",
    label: "Request Verification",
    help: "Hold request until sender verifies registered email or Member ID.",
  },
];

export function OverrideDialog({
  open,
  entry,
  displayedResult,
  draftReply,
  isSubmitting,
  onClose,
  onSubmitOverride,
}: OverrideDialogProps) {
  const recommendedAction = displayedResult?.agent?.action ?? "escalate_to_human";
  const [selectedAction, setSelectedAction] = useState<TriageAction>(recommendedAction);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedAction(
        (entry?.staff_action?.final_action as TriageAction) || recommendedAction
      );
      setNotes(entry?.staff_action?.notes || "");
    }
  }, [open, entry, recommendedAction]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!entry) return;
    const trimmed =
      notes.trim() || "Thumbs-down feedback: staff overrode model recommendation";

    const previewId = displayedResult?.agent?.case_preview?.preview_id ?? null;
    const ok = await onSubmitOverride(entry.ticket_id, {
      recommended_action: recommendedAction,
      final_action: selectedAction,
      decision_type: "override",
      reply_text: draftReply,
      notes: trimmed,
      preview_id: previewId,
      engine: displayedResult?.engine ?? "jev",
    });

    if (ok) {
      onClose();
    }
  };

  return (
    <NativeDialog open={open} onClose={onClose} labelledBy="override-dialog-title">
      <form onSubmit={(e) => void handleSubmit(e)} className="p-5">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 id="override-dialog-title" className="text-base font-semibold text-slate-900">
              Override Model Recommendation
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ticket <span className="font-mono font-semibold">{entry?.ticket_id}</span> -
              Recommended:{" "}
              <code className="font-mono text-slate-700">{recommendedAction}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close override dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-800">
              Select Staff Final Action
            </legend>
            <div className="mt-2 space-y-2">
              {ACTION_OPTIONS.map((opt) => {
                const inputId = `override-opt-${opt.value}`;
                const checked = selectedAction === opt.value;
                return (
                  <label
                    key={opt.value}
                    htmlFor={inputId}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-xs transition-colors ${
                      checked
                        ? "border-blue-600 bg-blue-50/50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name="override_final_action"
                      value={opt.value}
                      checked={checked}
                      onChange={() => setSelectedAction(opt.value)}
                      className="mt-0.5 accent-blue-700"
                    />
                    <div>
                      <div className="font-semibold text-slate-900">{opt.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600">{opt.help}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="override-rationale-input"
              className="block text-xs font-semibold text-slate-800"
            >
              Override Rationale
            </label>
            <p id="override-rationale-hint" className="mt-0.5 text-[11px] text-slate-500">
              Optional. Defaults to a thumbs-down feedback note if left blank.
            </p>
            <textarea
              id="override-rationale-input"
              rows={3}
              autoFocus
              value={notes}
              aria-describedby="override-rationale-hint"
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optionally explain why staff selected this action instead of the recommendation…"
              className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-600"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : "Record Staff Override"}
          </button>
        </div>
      </form>
    </NativeDialog>
  );
}
