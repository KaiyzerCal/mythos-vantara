---
name: character-animation
version: "1.0"
owner: Writer
triggers: ["character animation", "pixel art", "spritesheet", "sprite animation", "game character", "64x64 sprite", "character sprite", "pixel character"]
requires: []
primaryEnv: claude
---

# Skill: character-animation

**Owner:** Writer

Generates game-ready 64×64 pixel-art character spritesheets with directional animations from text prompts or reference images. Outputs ready-to-import atlas files with palette cleanup and QA reports.

## Output Spec

- **Size:** 64×64 pixels per frame
- **Animations:** idle, walk, attack (configurable scope)
- **Directions:** 8 (N, NE, E, SE, S, SW, W, NW)
- **Format:** PNG spritesheet atlas + contact sheet for verification
- **Post-processing:** palette quantization, edge hardening, frame integrity validation

## Input

```
CHARACTER: [description — e.g. "armored knight with glowing sword", "robed mage with staff", "goblin rogue in leather armor"]
STYLE: [pixel art style — e.g. "RPG Maker", "SNES JRPG", "16-bit roguelike", "tactical wargame"]
SCOPE: [walk-only | idle-walk | combat | full]
PALETTE: [optional — e.g. "16-color NES palette", "32-color warm tones", "derive from reference image"]
REFERENCE: [optional image URL or description of visual reference]
```

## Scope Definitions

| Scope | Animations included | Frames per direction |
|---|---|---|
| `walk-only` | walk | 4 |
| `idle-walk` | idle, walk | 4+4 |
| `combat` | idle, walk, attack | 4+4+6 |
| `full` | idle, walk, attack, death | 4+4+6+4 |

## Production Pipeline

### Phase 1 — Character Sheet
Generate a front-facing character reference sheet: full body, 3/4 view, and close-up of distinctive features. Establish color palette (max 32 colors for 64×64 scale).

### Phase 2 — Animation Frames
For each animation in scope:
- Generate base frames for the primary direction (S = south/facing-camera)
- Derive remaining 7 directions via geometric transformation + manual correction
- Apply pixel cleanup: remove anti-aliasing artifacts, harden edges, quantize to palette

### Phase 3 — Atlas Composition
Arrange frames into a standard spritesheet layout:
```
Row 0: Walk South (4 frames)
Row 1: Walk West  (4 frames)
Row 2: Walk East  (4 frames)
Row 3: Walk North (4 frames)
... (additional animations follow)
```

### Phase 4 — QA Report
```
SPRITE QA REPORT
Character: [name/description]
Total frames: [N]
Atlas size: [W×H px]
Palette: [N colors used]

Frame checks:
✅ / ❌ Idle: [N frames] — [status]
✅ / ❌ Walk: [N frames × 8 directions] — [status]
✅ / ❌ Attack: [N frames × 8 directions] — [status]

Pixel quality:
• Edge hardness: PASS / FAIL — [details]
• Palette consistency: PASS / FAIL — [N colors, matches reference]
• Frame continuity: PASS / FAIL — [motion smoothness check]

Output files:
• [character-name]-atlas.png — [W×H px, N frames]
• [character-name]-contact.png — all frames labeled for verification
```

## Rules

- Always produce the QA report. No atlas ships without it.
- Palette must be established in Phase 1 before any animation work begins.
- South-facing frames are the primary reference; all other directions derive from them.
- Maximum 32 colors per character to ensure compatibility with retro renderers.
- Contact sheet (labeled individual frames) is mandatory for human verification.
