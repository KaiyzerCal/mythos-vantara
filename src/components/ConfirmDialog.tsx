import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  title = "Delete this item?",
  description = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  danger = true,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Dialog */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 w-full max-w-sm bg-card border border-border rounded-xl shadow-2xl p-5"
          >
            <button
              onClick={onCancel}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>

            <div className="flex items-start gap-3 mb-4">
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${danger ? "bg-destructive/10" : "bg-amber-500/10"}`}>
                <AlertTriangle size={16} className={danger ? "text-destructive" : "text-amber-400"} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                {description && (
                  <p className="text-xs text-muted-foreground mt-1">{description}</p>
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="px-4 py-1.5 text-xs font-mono border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={`px-4 py-1.5 text-xs font-mono rounded-lg font-semibold transition-colors ${
                  danger
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook for managing confirm dialog state
export function useConfirmDialog() {
  return {
    // Use this pattern: const { confirmState, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog()
    // See ConfirmDialog component above for usage
  };
}
