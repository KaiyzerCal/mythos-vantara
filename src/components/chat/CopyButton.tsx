import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  content: string;
  className?: string;
  size?: number;
  title?: string;
}

/** Universal copy-to-clipboard button used across all chat surfaces. */
export function CopyButton({ content, className, size = 12, title = "Copy message" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // Fallback for non-secure contexts / older Android WebViews
        const ta = document.createElement("textarea");
        ta.value = content;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors",
        className,
      )}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}
