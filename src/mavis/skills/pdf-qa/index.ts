// SKILL: pdf-qa
// Pattern from 500-AI-Agents #03 — PDF Q&A agent (LlamaIndex + RAG).
// Calls mavis-doc-extract to ingest a document, then answers questions about it.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "pdf-qa", output: "Share a document URL or paste content along with your question and I'll answer it from the document." };
  }

  // Try to extract URL from input
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  const url = urlMatch?.[0];
  const question = url ? input.replace(url, "").trim() || "Summarize this document" : input.trim();

  try {
    if (url) {
      const { data, error } = await supabase.functions.invoke("mavis-doc-extract", {
        body: { url, query: question },
      });
      if (error) throw error;
      return { skillName: "pdf-qa", output: data?.answer ?? data?.content ?? data?.output ?? JSON.stringify(data) };
    }
    // No URL — treat input as pasted document content with embedded question
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are a document analyst. The user has pasted document content along with a question. Answer the question accurately and specifically based ONLY on what is in the provided document. Quote relevant sections when useful. If the answer is not in the document, say so.",
        mode: "ARCH",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "pdf-qa", output: data?.content ?? "[No output]" };
  } catch (err) {
    return { skillName: "pdf-qa", output: `Document Q&A failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "pdf-qa",
  description: "Answers questions about any document, PDF, or pasted content — accurate, source-grounded answers",
  keywords: [
    "read this document", "what does this document say", "summarize this pdf",
    "answer from this doc", "pdf question", "document question", "what's in this file",
    "read this pdf", "analyze this document", "extract from document", "document qa",
    "what does the contract say", "summarize this report",
  ],
}, handler);
