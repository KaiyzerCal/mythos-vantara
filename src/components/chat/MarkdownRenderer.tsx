import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check, FileCode } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  onOpenArtifact?: (code: string, lang: string) => void;
  className?: string;
}

function CodeBlock({
  code,
  lang,
  onOpenArtifact,
}: {
  code: string;
  lang: string;
  onOpenArtifact?: (code: string, lang: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const showArtifact = onOpenArtifact && code.length > 200;

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-border bg-black/60">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
        <span className="text-xs font-mono text-muted-foreground">{lang || "text"}</span>
        <div className="flex items-center gap-1.5">
          {showArtifact && (
            <button
              onClick={() => onOpenArtifact(code, lang || "text")}
              className="flex items-center gap-1 text-xs font-mono text-cyan-400 border border-cyan-900/40 rounded px-2 py-0.5 hover:bg-cyan-900/20 transition-colors"
            >
              <FileCode size={10} /> Artifact
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs font-mono text-muted-foreground border border-border rounded px-2 py-0.5 hover:bg-muted/40 transition-colors"
          >
            {copied ? (
              <>
                <Check size={10} className="text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={10} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      {/* Code body */}
      <pre className="px-4 py-3 overflow-x-auto text-xs font-mono text-foreground/90 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, onOpenArtifact, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          code({ className: codeClassName, children, ...props }) {
            const codeStr = String(children ?? "");
            const langMatch = /language-(\w+)/.exec(codeClassName ?? "");
            const lang = langMatch ? langMatch[1] : "";
            // Treat as block if there's a language class OR the content has newlines
            const isBlock = !!langMatch || codeStr.includes("\n");

            if (isBlock) {
              return (
                <CodeBlock
                  code={codeStr.replace(/\n$/, "")}
                  lang={lang}
                  onOpenArtifact={onOpenArtifact}
                />
              );
            }

            // Inline code
            return (
              <code
                className="px-1.5 py-0.5 rounded text-xs font-mono bg-muted/50 text-foreground/90"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
