---
name: design-md
version: "1.0"
owner: Writer
triggers: ["design.md", "design tokens", "design system for agents", "design token spec", "agent-friendly design system", "wcag contrast", "design lint", "tailwind export", "dtcg tokens"]
requires: []
primaryEnv: claude
---

# Skill: design-md

**Owner:** Writer

Creates and validates `design.md` files — a format that encodes visual design systems in YAML front matter (exact token values) + Markdown body (design reasoning). Bridges machine readability and designer intent so coding agents can apply styles correctly.

## Why design.md

Coding agents fail at design because:
1. They don't know the *values* (what exact color is "brand blue"?)
2. They don't know the *rules* (when do you use `text-sm` vs `text-base`?)
3. They don't know the *intent* (why is this component this shade?)

`design.md` solves all three: YAML for exact values, Markdown for reasoning.

## Format Spec

```yaml
---
# YAML front matter — exact token values
colors:
  primary: "oklch(56% 0.2 240)"        # brand blue
  primary-hover: "oklch(50% 0.2 240)"  # darkened for hover states
  background: "oklch(99% 0 0)"         # near-white
  surface: "oklch(96% 0 0)"            # card/panel backgrounds
  text: "oklch(15% 0 0)"               # primary text
  text-muted: "oklch(50% 0 0)"         # secondary/helper text
  border: "oklch(88% 0 0)"             # default borders
  error: "oklch(55% 0.22 30)"          # destructive/error state
  success: "oklch(60% 0.2 145)"        # success state

typography:
  sans: "Inter, system-ui, sans-serif"
  mono: "JetBrains Mono, 'Courier New', monospace"
  sizes:
    xs: "0.75rem"     # 12px — captions, labels
    sm: "0.875rem"    # 14px — helper text, metadata
    base: "1rem"      # 16px — body text
    lg: "1.125rem"    # 18px — large body, card titles
    xl: "1.25rem"     # 20px — section headings
    2xl: "1.5rem"     # 24px — page headings
    3xl: "2rem"       # 32px — hero headings

spacing:
  1: "0.25rem"
  2: "0.5rem"
  4: "1rem"
  6: "1.5rem"
  8: "2rem"
  12: "3rem"
  16: "4rem"
  section: "5rem"     # vertical section padding

radius:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  full: "9999px"      # pills and avatars

components:
  button-primary:
    bg: colors.primary
    text: "white"
    padding: "0.5rem 1rem"
    radius: radius.md
    hover-bg: colors.primary-hover
  card:
    bg: colors.surface
    border: colors.border
    radius: radius.lg
    padding: "1.5rem"
---

# Design Rationale

## Color Philosophy
[Explain color choices — contrast ratios, brand alignment, accessible combinations]

## Typography Rules
- `text-xs` for metadata and labels that support primary content
- `text-sm` for body text in dense contexts (tables, sidebars)
- `text-base` for standard body copy
- Use `font-mono` only for code, numbers in data tables, and timestamps

## Spacing System
8pt grid. All spacing values are multiples of 0.25rem. Never use arbitrary values outside this scale.

## Dark Mode
[Explain dark mode token mappings if applicable]

## When to Break the Rules
[Explicit exceptions and why they exist]
```

## CLI Commands

### `design-md lint`
Validates the design.md file against 9 rules:
- No broken token references (colors.foo where foo doesn't exist)
- Primary color defined
- WCAG contrast ratios met (text on background, text on primary)
- Typography scale complete (xs → 3xl)
- No missing required sections
- Spacing values on 8pt grid
- Component tokens reference existing base tokens
- Color values parseable (hex, rgb, oklch, named)
- Token names follow kebab-case convention

### `design-md diff`
Detects token changes between commits. Shows what changed, what broke, and what new tokens appeared.

### `design-md export`
Converts to other formats:
- `--format tailwind` → Tailwind CSS config object
- `--format dtcg` → W3C Design Tokens Community Group format
- `--format css` → CSS custom properties

### `design-md spec`
Outputs the format specification for the current version.

## Creating a design.md

When given a design (Figma, screenshot, URL, or description):

1. **Extract palette** — identify all colors in use, group by role
2. **Measure typography** — note font families, sizes, weights, line heights
3. **Map spacing** — reverse-engineer the grid from element measurements
4. **Define components** — document token-level specs for repeated patterns
5. **Write rationale** — explain choices so agents applying the system understand intent
6. **Lint** — validate WCAG contrast before declaring complete

## Output

```
DESIGN.MD CREATED: [project name]

Tokens defined:
• Colors: [N] tokens
• Typography: [N] size definitions, [N] font families
• Spacing: [N] values
• Components: [N] component specs

Lint results:
✅ / ❌ Contrast ratios (text/bg): [AA/AAA/FAIL]
✅ / ❌ Contrast ratios (text/primary): [AA/AAA/FAIL]
✅ / ❌ All token references valid
✅ / ❌ Spacing on 8pt grid

Export targets available: tailwind | dtcg | css
```

## Rules

- Color values must be in oklch for perceptual uniformity. Convert hex on import.
- WCAG AA (4.5:1 contrast) is the minimum for body text — AAA (7:1) for small text.
- Never define an arbitrary spacing value outside the declared scale.
- Rationale sections are not optional — an agent that can't explain *why* a token exists will misapply it.
- Token references in components must point to named tokens, not raw values.
