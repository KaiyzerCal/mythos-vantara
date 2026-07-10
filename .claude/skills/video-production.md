---
name: video-production
version: "1.0"
owner: Writer
triggers: ["video production", "make a video", "produce video", "ai video", "video pipeline", "explainer video", "documentary", "trailer", "montage", "video from script", "openmontage"]
requires: ["remotion"]
primaryEnv: claude
---

# Skill: video-production

**Owner:** Writer

Full AI-driven video production pipeline from concept to final render. Orchestrates research, scripting, asset generation, editing, and composition. Supports 12 video genres with approval gates at each stage and budget controls.

## Supported Genres

| Genre | Description | Typical length |
|---|---|---|
| explainer | Concept breakdown with animation | 60-180s |
| documentary | Real footage + narration + b-roll | 2-10 min |
| trailer | Hype reel for a product/project | 30-90s |
| animation | Motion graphics / character animation | Any |
| talking-head | Speaker + lower thirds + b-roll | Any |
| podcast | Audio-first with visual treatment | Any |
| social-clip | Vertical short-form (9:16) | 15-60s |
| presentation | Data-driven slide-style | Any |

## Production Pipeline

### Stage 1 — Research
Gather source material:
- Live web research for facts, statistics, quotes
- Reference video analysis (style, pacing, structure)
- Asset audit (what exists vs. what must be generated)

**Gate:** Research brief approved before scripting begins.

### Stage 2 — Proposal
One-page production brief:
```
PRODUCTION PROPOSAL
Genre: [type]
Concept: [1 sentence]
Key message: [what the viewer should remember]
Target audience: [who]
Tone: [e.g. authoritative, playful, cinematic]
Estimated runtime: [X]s
Asset strategy: [real footage | AI-generated | mixed]
Provider selection: [video gen | image gen | TTS | music]
Budget ceiling: [USD]
```

**Gate:** Proposal approved before scripting.

### Stage 3 — Script
Full production script with:
- Narration (line-by-line, timed to seconds)
- Visual direction for each line (what appears on screen)
- B-roll callouts (specific footage/image needed)
- Music/SFX cues

### Stage 4 — Scene Plan
Break script into discrete scenes:
```
Scene [N]: [title]
  Duration: [Xs]
  Narration: "[text]"
  Visual: [description of what's on screen]
  Assets needed: [list]
  Motion: [static | pan | zoom | animated]
```

**Gate:** Scene plan approved before asset generation.

### Stage 5 — Asset Generation
Generate all assets per scene plan:

**Video generation providers** (in priority order):
1. Kling — best motion quality
2. Runway Gen-3 — strong for cinematic
3. Google Veo — realistic scenes
4. Local GPU (WAN 2.1, Hunyuan) — cost-free, slower

**Image generation:**
1. FLUX — highest quality
2. Imagen — photorealistic
3. Stock (Pexels, Unsplash, Pixabay) — free, fast

**Audio:**
- Narration: ElevenLabs (preferred) / Google TTS (free)
- Music: Suno generation or royalty-free library
- SFX: Freesound.org catalog

### Stage 6 — Edit
Assemble timeline:
- Sync narration audio to scene timing
- Place b-roll at correct timestamps
- Add captions (word-level sync via Whisper)
- Apply transitions between scenes

### Stage 7 — Compose & Render
Compose final video:
- **Remotion** for data-driven / animated sequences
- **HyperFrames** (HTML/GSAP) for motion graphics
- **FFmpeg** for post-production (color, audio mix, export)

**Post-render self-review:**
- Technical: resolution, codec, bitrate, audio sync
- Quality: pacing, caption accuracy, visual consistency
- Content: key message lands, CTA is clear

**Gate:** Self-review passed before delivery.

## Budget Tracking

```
PRODUCTION BUDGET
Total ceiling: $[X]

Research: $0 (free tools)
Script: $0 (AI)
Image gen: $[N] × [provider rate] = $[subtotal]
Video gen: [N] clips × $[rate] = $[subtotal]
TTS narration: [N] chars × $[rate] = $[subtotal]
Music: $[subtotal]
Rendering: $[subtotal]
─────────────────
Total: $[X] / ceiling: $[Y]
Status: WITHIN BUDGET / OVER BY $[Z]
```

## Output

```
VIDEO PRODUCTION COMPLETE
Title: [title]
Genre: [type]
Runtime: [X]s
File: [output-path]

Production summary:
• Scenes: [N]
• Assets generated: [N images, N video clips, Ns narration]
• Providers used: [list]
• Total cost: $[X]

Approval gates cleared: Research ✅ | Proposal ✅ | Scene Plan ✅ | Post-render ✅
```

## Rules

- No stage begins before its gate is cleared. Approval is not implied by silence.
- Content from Archive.org, NASA, Wikimedia is free to use; always verify license before using stock footage.
- Narration and visual must be synchronized — off-sync video fails the post-render check.
- Budget ceiling is a hard cap, not a target. If generation costs approach ceiling, use cheaper providers.
- Post-render self-review is mandatory — never deliver without it.
