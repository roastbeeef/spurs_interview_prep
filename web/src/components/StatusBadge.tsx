import type { ReactNode } from "react";

export type BadgeTone = "emerald" | "amber" | "crimson" | "cobalt" | "navy" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  crimson: "bg-red-50 text-red-800 border-red-200",
  cobalt: "bg-blue-50 text-blue-800 border-blue-200",
  navy: "bg-slate-900 text-white border-slate-900",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

interface StatusBadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
