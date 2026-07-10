---
name: clone-website
version: "1.0"
owner: HR
triggers: ["clone website", "reverse engineer website", "clone-website", "website cloner", "recreate website", "copy website design", "extract design tokens from site"]
requires: []
primaryEnv: claude
---

# Skill: clone-website

**Owner:** HR

Reverse-engineers any website into a clean, modern codebase using a multi-phase AI pipeline. Analyzes design, extracts tokens and assets, writes component specs, and dispatches parallel builders.

## Pipeline

### Phase 1 — Design Analysis
Scrape the target URL and extract:
- Color palette (primary, secondary, accent, background, text)
- Typography (font families, sizes, weights, line heights)
- Spacing system (padding/margin values in use)
- Layout grid (columns, max-width, breakpoints)
- Component inventory (what distinct UI patterns exist)

Output: design token file (YAML front matter + Markdown rationale).

### Phase 2 — Asset Extraction
Download all referenced assets:
- Images → `/public/images/`
- Fonts → `/public/fonts/` (or reference CDN if license permits)
- Icons → identify icon library in use (Lucide, Heroicons, Phosphor, etc.)
- SVGs → extract inline SVGs as components

### Phase 3 — Component Specification
Write a spec for each UI section:
```
SECTION: [name]
Layout: [describe the layout pattern]
Components needed: [list sub-components]
Data: [static | dynamic, describe data shape]
Interactions: [hover states, animations, responsive behavior]
Assets: [which extracted assets does this section use]
```

### Phase 4 — Parallel Build
Dispatch one builder per section, working in parallel:
- Each builder receives: design tokens + relevant component spec + extracted assets
- Stack: Next.js 16 (App Router, React 19, TypeScript), Tailwind CSS v4, shadcn/ui
- Each component is a self-contained `.tsx` file

### Phase 5 — Assembly & Visual Diff
Assemble all sections into a working Next.js page.
Run visual diff:
- Screenshot the original URL
- Screenshot the cloned page
- Compare side-by-side and list deviations

Output: visual diff report + punch list of remaining gaps.

## Stack

```
Framework: Next.js 16 (App Router, React 19, TypeScript)
Styling: Tailwind CSS v4 with oklch design tokens
Components: shadcn/ui (Radix primitives)
Icons: Lucide React (default, swap if target uses different library)
Fonts: next/font (Google Fonts) or self-hosted
```

## Design Token Format (Phase 1 output)

```yaml
---
colors:
  primary: "oklch(56% 0.2 240)"
  background: "oklch(99% 0 0)"
  text: "oklch(15% 0 0)"
typography:
  sans: "Inter, system-ui"
  mono: "JetBrains Mono, monospace"
  heading-xl: "clamp(2rem, 5vw, 4rem)"
spacing:
  base: "1rem"
  section: "5rem"
  max-width: "80rem"
---
# Design Rationale

Colors follow a minimal high-contrast palette. Heading scale uses fluid type
for responsive text without breakpoint overrides. Section spacing is generous
to give content room to breathe.
```

## Output Format

```
CLONE REPORT: [target URL]

Phase 1 — Design Analysis ✅
• Colors: [N] tokens extracted
• Typography: [N] font definitions
• Spacing: [N] spacing values
• Components identified: [N sections]

Phase 2 — Assets ✅
• Images: [N downloaded]
• Fonts: [N families]
• Icons: [library identified]

Phase 3 — Specs ✅
• [N] component specs written

Phase 4 — Build ✅
• [N] components built in parallel

Phase 5 — Visual Diff
• Match: [X]%
• Gaps: [list deviations]
• Status: DONE / NEEDS ITERATION

Files created:
[list of .tsx files and public assets]
```

## Rules

- Never hardcode colors as hex — convert to oklch tokens in Phase 1.
- Check font licenses before self-hosting. Use next/font Google Fonts for Google-hosted fonts.
- Visual diff is mandatory. "It looks right" is not a review.
- If the target site uses complex animations (Three.js, WebGL), note them in the spec but defer — ship layout first.
- Do not copy proprietary content (text, photos). Clone the structure and design system only.
