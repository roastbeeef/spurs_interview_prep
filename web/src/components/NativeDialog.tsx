import { useEffect, useRef, type ReactNode } from "react";

interface NativeDialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  closedBy?: "any" | "closerequest" | "none";
  maxWidthClass?: string;
  children: ReactNode;
}

export function NativeDialog({
  open,
  onClose,
  labelledBy,
  closedBy = "any",
  maxWidthClass = "max-w-xl",
  children,
}: NativeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Progressive light-dismiss fallback (<= 12 lines) when closedBy is unavailable
    if (closedBy === "any" && !("closedBy" in HTMLDialogElement.prototype)) {
      let downOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onDown = (e: PointerEvent) => {
        downOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (downOutside && isOutside(e)) dialog.close();
      };
      dialog.addEventListener("pointerdown", onDown);
      dialog.addEventListener("pointerup", onUp);
      return () => {
        dialog.removeEventListener("close", handleClose);
        dialog.removeEventListener("pointerdown", onDown);
        dialog.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose, closedBy]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      {...({ closedby: closedBy } as Record<string, string>)}
      className={`${maxWidthClass} w-[calc(100%-2rem)]`}
    >
      {children}
    </dialog>
  );
}
