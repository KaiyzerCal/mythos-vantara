---
name: inbox-zero
version: "1.0"
owner: Analyst
triggers: ["inbox zero", "email management", "ai email", "email assistant", "organize inbox", "email rules", "reply drafting", "bulk unsubscribe", "cold email blocker", "email analytics"]
requires: []
primaryEnv: claude
---

# Skill: inbox-zero

**Owner:** Analyst

AI-powered email management system. Organizes inboxes, drafts replies, manages calendars, handles attachments, blocks cold emails, and tracks reply status. Self-hostable (open source) alternative to Fyxer.

## Capabilities

| Feature | What it does |
|---|---|
| AI Rules | Plain-English email routing rules ("archive all newsletters older than 30 days") |
| Reply Zero | Track which emails need replies; surface the oldest unanswered first |
| Bulk Unsubscribe | One-click unsubscribe from newsletters and marketing lists |
| Cold Email Blocker | Auto-detect and archive/block unsolicited outreach |
| Reply Drafting | Generate context-aware draft replies from email thread |
| Meeting Briefs | Summarize meeting context before a calendar event |
| Attachment Filing | Auto-file attachments to Google Drive / cloud storage |
| Analytics | Email volume, response time, sender patterns |
| Integrations | Slack (digest + reply from Slack), Telegram |

## AI Rules Format

Rules are written in plain English. Examples:

```
"Archive any email from a newsletter that I haven't opened in 30 days."
"Label emails from @company.com as 'Work' and mark as important."
"If subject contains 'invoice', forward to accounting@company.com."
"Auto-reply to cold emails with: 'Thanks for reaching out. I'll respond within 5 business days if this is a fit.'"
"Archive all GitHub notification emails except those that mention my name."
```

## Reply Zero Workflow

When invoked as an email triage session:

```
INBOX TRIAGE — [date]

Emails requiring reply: [N]

Priority 1 (oldest, >72h unanswered):
[1] From: [sender] | Subject: [subject] | Received: [N days ago]
    Context: [1-sentence summary of what they need]
    Draft: [suggested reply — edit before sending]

Priority 2 (24-72h):
[N emails listed]

Priority 3 (<24h):
[N emails listed]

Completed this session: [N replied, N archived, N unsubscribed]
Inbox delta: [before] → [after]
```

## Draft Reply Format

```
DRAFT REPLY
To: [sender]
Re: [subject]
Thread context: [1-sentence summary of thread]

---
[Draft reply text]
---

Tone: [formal/casual — matched to thread]
Action items for sender: [list if any]
Action items for Calvin: [list if any]
Send? [YES — ready | REVIEW — verify facts | HOLD — needs more context]
```

## Cold Email Detection

Flag an email as cold outreach if:
- Sender is not in contacts/previous threads
- Email contains pricing, "quick call", "partnership opportunity", "love what you're building"
- Subject line starts with first name ("Calvin, I wanted to...")
- Sender domain is a sales tool (outreach.io, salesloft.com, etc.)

Actions:
- `BLOCK` — never receive from this sender again
- `ARCHIVE` — remove from inbox, don't block domain
- `LABEL` — tag as cold outreach for review later

## Meeting Brief Format

```
MEETING BRIEF: [event title]
When: [date, time, duration]
With: [attendees]

Context:
• Last interaction: [date] — [what was discussed]
• Open items from prior meeting: [list]
• Their recent news: [any relevant updates from email/calendar]

Agenda (as known):
[list]

Talking points:
[suggested points to raise based on context]

Materials to prep:
[files, reports, or links that would be useful]
```

## Rules

- Draft replies are suggestions — never send without human review.
- Cold email detection errs on the side of caution: false positive (flagging legit email) is less harmful than false negative (missing a real cold email that pollutes inbox).
- Reply Zero prioritizes by recency of need, not recency of receipt — a 72-hour-old email that needs a same-day reply ranks above a 24-hour-old FYI.
- Analytics are for behavior change, not surveillance — surface patterns Calvin can act on, not vanity metrics.
- Meeting briefs are generated 30 minutes before the event — not days in advance (context goes stale).
