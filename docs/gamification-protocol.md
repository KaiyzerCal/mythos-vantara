# GAMIFICATION PROTOCOL (v1)

The standing procedure for turning real life into quests, XP, skill growth and story inside VANTARA / MAVIS. It applies to every new quest and to every retroactive one, from any surface (chat, voice, Telegram, personas, automations). If this document and a habit disagree, this document wins.

## 1. Prime rule: nothing counts until it is written
- Never say "saved", "created", "updated", "linked" or "added" unless a write action ran **this turn** and returned success. Say what the action result says, not what was intended.
- If no action ran, say so plainly ("I haven't saved that yet") and either run it now or offer to.
- If an action failed or dropped part of a request (for example a skill that does not exist), report that in the same message. Never smooth it over.

## 2. Real data only
- Link skills by their **exact name from the operator's skill list**. Never invent skill names or ids. If no real skill fits, say so; do not stretch a loose match (a coordination quest does not train Speed Reading).
- 1 to 3 regular skills, plus at most 2 Beyonder sequences (the pathway's current sequence, not a locked one). One short reason per link.
- After saving, report the skills **as the system returned them**, including whether each was chosen by MAVIS or auto-matched.

## 3. Quest anatomy (every quest, no blanks)
| Field | Rule |
|---|---|
| Title | Verb-led and specific. |
| Description | What, who, where, why it matters. |
| Type | daily, side, main, epic, or boss. |
| Difficulty | Easy, Normal, Hard, Extreme, Impossible. |
| XP reward | Easy 25-50, Normal 50-150, Hard 150-300, Extreme 300-600, Impossible 600+. |
| Codex Points | About XP divided by 5. |
| Progress target | Number of steps (1 for a single event). |
| Completion criteria | 2 to 4 checkable conditions, not feelings. |
| Linked skills | Section 2. |
| Stat or energy mapping | Optional `stat:STR`-style mapping when a stat genuinely trains. |
| Buffs | Earned on success; small (about 10 to 20 percent) and time-boxed. |
| Debuffs | The honest cost of neglect or failure; small and time-boxed. Derived from what the operator actually said, never decoration. |
| Loot | Optional; rarity matches difficulty. |

## 4. What completion actually does (so numbers are honest)
- XP is awarded; every linked skill gains proficiency of `clamp(floor(XP / 50) x multiplier, 2, 15)` points, with multipliers Easy 1, Normal 2, Hard 3, Extreme 5, Impossible 8. Example: a Normal 150 XP quest gives +6 to each linked skill.
- A skill reaching 100 unlocks anything gated on it (this is how Beyonder sequences advance).
- Codex Points go to the wallet; buffs, debuffs and loot are logged and applied; a stat mapping adds up to +5.

## 5. The fill-out sequence (new or retroactive)
1. Understand the event: who, what, outcome, what it cost, what it showed.
2. Create the quest with **all** fields in one action, linking skills by name.
3. Read the action result. Verify it saved and what the links really are.
4. Report exactly that: title, XP, Codex Points, linked skills (real names), effects. If anything is missing or was dropped, say so and fix it with an update action.
5. Capture the lesson in one line (journal or the quest's notes) so the story and the skill growth stay connected.

## 6. Retroactive entries
- Log what already happened as a quest, then complete it so XP and proficiency apply, unless the operator says not to award. Put the real date in the description.
- Never double count: check for an existing quest for the same event first and update it instead.

## 7. Reflection and psychology
- Pair interpersonal or high-stress quests with the relevant inner skill (for example Emotional Alchemy) only when the situation really exercised it.
- Frame lessons as what the operator did well and what to adjust, never as shame. Keep the tone of an ally, not a scorekeeper.

## 8. Where things live
- Quests: Quests tab. Reflections: Journal. Reference documents: Vault (category gamification). Connected concepts: the knowledge graph notes. Standing rules: MAVIS standing orders, which load into every conversation.

## 9. Anti-patterns (never do these)
- Claiming a save that did not happen.
- Listing skills in chat that are not the skills stored on the quest.
- Inventing ids or skill names.
- Leaving rewards, criteria, buffs or debuffs blank, then describing them as if they were set.
- Ending with several follow-up questions; at most one.
