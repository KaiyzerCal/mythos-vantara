import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Polls for pending async media generation jobs embedded as hidden comments
// in chat messages. When a job completes, updates the message content with the
// finished URL so the InlineMediaPlayer can render it automatically.
//
// Skills embed a metadata comment: <!-- MAVIS_POLL:{json} -->
// where json has { fn, request_id, provider }

const POLL_COMMENT_RE = /<!--\s*MAVIS_POLL:(\{[^}]+\})\s*-->/;
const POLL_INTERVAL_MS = 8000;
const MAX_POLLS = 45; // ~6 minutes before giving up

interface PollJob {
  messageId: string;
  fn: string;
  request_id: string;
  provider: string;
  pollCount: number;
}

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  [key: string]: unknown;
};

type SetMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;

export function useMediaPoller(
  messages: ChatMessage[],
  setMessages: SetMessages,
) {
  const jobsRef = useRef<Map<string, PollJob>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect new processing messages and register poll jobs
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      if (jobsRef.current.has(msg.id)) continue;

      const match = POLL_COMMENT_RE.exec(msg.content);
      if (!match) continue;

      try {
        const meta = JSON.parse(match[1]);
        if (!meta.fn || !meta.request_id) continue;
        jobsRef.current.set(msg.id, {
          messageId: msg.id,
          fn: meta.fn,
          request_id: meta.request_id,
          provider: meta.provider ?? "unknown",
          pollCount: 0,
        });
      } catch { /* malformed comment — skip */ }
    }
  }, [messages]);

  // Start polling interval
  useEffect(() => {
    if (timerRef.current) return; // already running

    timerRef.current = setInterval(async () => {
      const jobs = [...jobsRef.current.values()];
      if (!jobs.length) return;

      for (const job of jobs) {
        job.pollCount++;

        if (job.pollCount > MAX_POLLS) {
          // Timed out — remove job, update message
          jobsRef.current.delete(job.messageId);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === job.messageId
                ? { ...m, content: m.content.replace(POLL_COMMENT_RE, "\n\n⏱ Generation timed out. Try again.") }
                : m
            )
          );
          continue;
        }

        try {
          const { data, error } = await (supabase as any).functions.invoke(job.fn, {
            body: { action: "poll", request_id: job.request_id, provider: job.provider },
          });

          if (error || !data) continue;

          if (data.status === "complete" && data.url) {
            // Job done — update message content
            jobsRef.current.delete(job.messageId);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== job.messageId) return m;
                const cleaned = m.content.replace(POLL_COMMENT_RE, "");
                return {
                  ...m,
                  content: cleaned + `\n\n**Audio URL:** ${data.url}`,
                };
              })
            );
          } else if (data.status === "failed" || data.error) {
            jobsRef.current.delete(job.messageId);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === job.messageId
                  ? { ...m, content: m.content.replace(POLL_COMMENT_RE, `\n\n❌ Generation failed: ${data.error ?? "unknown error"}`) }
                  : m
              )
            );
          }
          // else still processing — continue polling
        } catch { /* network error — retry next tick */ }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, []);
}
