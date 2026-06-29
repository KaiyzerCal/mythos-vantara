# MAVIS — Session Archive Protocol
**Folder:** 11_SESSIONS

How conversations are archived so "what did we discuss six weeks ago" has a real answer.

---

## Storage

Sessions are stored in `mavis_memory` with:
- `role = "assistant"` or `"user"` per turn
- `session_id` = UUID of the session (`mavis_sessions` table)
- `timestamp` = Unix milliseconds
- `source` = "telegram" / "web" / "mavis-agent"

Sessions are write-once. Past conversations are never edited.

---

## Archival Structure

Each session is flat by date — no topical nesting. Date is the index.

```
session: {uuid}
  created_at: {timestamp}
  source: {web|telegram|agent}
  exchange_count: N
  last_message_at: {timestamp}
```

Individual messages within a session:
```
mavis_memory:
  session_id: {uuid}
  role: user|assistant
  content: {message text}
  timestamp: {unix ms}
  importance_score: 1-10
  consolidated: false
```

---

## Retention Rules

| Age | Policy |
|---|---|
| 0–30 days | Full hot retrieval; surfaced by semantic search |
| 31–90 days | Reduced retrieval weight; still searchable |
| 90+ days | Consolidated (invisible to normal retrieval; available for forensic search) |
| 365+ days | Candidate for cold archive |

High-importance exchanges (score ≥ 7) are exempt from consolidation.

---

## How MAVIS Uses Session History

- Semantic search (`mavis-memory-embed`) finds relevant past exchanges by topic
- Pattern detection reads across sessions to identify behavioral trends
- MAVIS does not "load all sessions" — she loads by relevance
- When the operator references a past conversation ("remember when we talked about X"), MAVIS queries the semantic index, not a date-sorted dump

---

## What Does NOT Get Archived

- Internal tool call chains (pre-stream reasoning)
- System messages (injected context blocks)
- Failed messages (error states)
- Telegram voice transcriptions (the transcribed text is archived; the audio is not)

---

## Cross-Source Sessions

When an operator talks to MAVIS via web AND telegram in the same day:
- Each surface has its own session ID
- Both sessions are visible to semantic search
- MAVIS is aware the operator uses multiple surfaces and synthesizes context across them when relevant
