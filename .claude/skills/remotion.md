---
name: remotion
version: "1.0"
owner: Writer
triggers: ["remotion", "programmatic video", "react video", "video from code", "data-driven video", "render video", "video generation react"]
requires: []
primaryEnv: claude
---

# Skill: remotion

**Owner:** Writer

Creates videos programmatically using React as the source of truth. Write React components, render videos. Supports data-driven batch rendering, interactive editing, captions, transitions, and cloud rendering at scale.

## Core Concept

Remotion treats video as a function of time: `f(frame) → pixels`. Every frame is a React component render. This means:
- Design systems and component libraries work as-is
- Any data source (API, DB, CSV) can drive video content
- Videos are versionable, testable, and composable

## Input

```
VIDEO_TYPE: [explainer | data-viz | social-clip | presentation | animation]
CONTENT: [data source / script / key messages]
DURATION: [seconds]
DIMENSIONS: [1920×1080 | 1080×1080 | 1080×1920 | custom]
STYLE: [minimal | branded | kinetic | documentary]
ASSETS: [fonts, images, audio — list URLs or describe]
CAPTIONS: [yes | no | auto-generated]
```

## Project Structure

```
my-video/
  src/
    Root.tsx        ← registers all compositions
    MyVideo.tsx     ← main video component
    components/     ← reusable animation components
  public/           ← static assets (fonts, images, audio)
  remotion.config.ts
```

## Animation Patterns

### Text Animations
```tsx
import { useCurrentFrame, interpolate, spring } from 'remotion';

const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
const slideUp = spring({ frame, fps: 30, config: { damping: 200 } });
```

### Data-Driven Sequences
```tsx
// Each data point becomes a timed sequence
const sequences = data.map((item, i) => ({
  from: i * fps * 3,        // 3 seconds per item
  durationInFrames: fps * 3,
  content: item
}));
```

### Captions
```tsx
import { Subtitles } from '@remotion/captions';
// Auto-sync captions to audio via whisper transcription
```

## Rendering Options

| Option | Use case | Command |
|---|---|---|
| Local Node.js | Development, small batch | `npx remotion render` |
| AWS Lambda | Batch rendering at scale | `npx remotion lambda render` |
| Vercel | Serverless on-demand | Use `@remotion/renderer` API |
| Client-side | Preview in browser | `<Player>` component |

## Output Format

```
REMOTION VIDEO
Title: [name]
Composition: [comp-id]
Duration: [X]s at [fps]fps = [N] frames
Dimensions: [W×H]

Components:
[list of React components used]

Data sources:
[list of APIs/files driving content]

Render command:
npx remotion render src/index.ts [comp-id] out/[name].mp4

Preview:
npx remotion preview src/index.ts
```

## Rules

- All animation values must use Remotion's `interpolate()` or `spring()` — never raw CSS transitions.
- Use `useCurrentFrame()` and `useVideoConfig()` at the top level of every animated component.
- Data fetching happens outside the component (passed as props) — no async inside render.
- Test compositions in the Remotion Studio preview before rendering.
- For batch rendering: always use `remotion lambda` or the server-side API — browser rendering doesn't scale.
