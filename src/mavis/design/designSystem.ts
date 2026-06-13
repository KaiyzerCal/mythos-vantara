// CODEXOS sovereign design system constants
// Used by MAVIS when generating any design artifact

export const CODEXOS_BRAND_SYSTEM = {
  name: "CODEXOS",
  description: "Sovereign, precise, dark, premium, living",

  colors: {
    background: "#0A0A0F",
    surface: "#111118",
    surfaceElevated: "#16161F",
    border: "#1E1E2E",
    borderSubtle: "#15152A",

    gold: "#C9A84C",
    electric: "#6366F1",
    forge: "#F97316",
    bio: "#22C55E",
    navi: "#8B5CF6",

    textPrimary: "#F1F0ED",
    textSecondary: "#9CA3AF",
    textMuted: "#4B5563",
    textInverse: "#0A0A0F",

    success: "#22C55E",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
  },

  typography: {
    fonts: {
      display: "'Space Grotesk', sans-serif",
      body: "'Inter', sans-serif",
      mono: "'JetBrains Mono', monospace",
    },
    scale: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
      "6xl": "3.75rem",
      "7xl": "4.5rem",
    },
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  },

  motion: {
    duration: { micro: "150ms", standard: "300ms", feature: "600ms", dramatic: "900ms" },
    easing: {
      enter: "cubic-bezier(0.16, 1, 0.3, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
    },
  },

  spacing: {
    sectionVertical: "py-24 md:py-32",
    containerMax: "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8",
    cardPadding: "p-6 md:p-8",
  },

  subBrands: {
    vantara: { accent: "#C9A84C", accentSecondary: "#6366F1", tone: "Imperial, technical, sovereign" },
    skyforgeai: { accent: "#F97316", accentSecondary: "#FBBF24", tone: "Sharp, results-driven, operational" },
    bioneer: { accent: "#22C55E", accentSecondary: "#86EFAC", tone: "Primal, disciplined, performance-first" },
    navi: { accent: "#8B5CF6", accentSecondary: "#C4B5FD", tone: "Energetic, playful, companion-like" },
    codexos: { accent: "#C9A84C", accentSecondary: "#6366F1", tone: "Mythic, architectural, ecosystem-wide" },
  },
} as const;

export const DESIGN_LAWS = {
  fitts: {
    name: "Fitts's Law",
    application: "CTAs must be large (min 44px touch target), centrally placed, and separated from distractors.",
  },
  jakob: {
    name: "Jakob's Law",
    application: "Innovate in content, not navigation. Use familiar patterns for menus and forms.",
  },
  aestheticUsability: {
    name: "Aesthetic-Usability Effect",
    application: "Invest in visual polish — it directly increases perceived functionality.",
  },
  hick: {
    name: "Hick's Law",
    application: "One primary CTA per section. Remove secondary options at conversion points.",
  },
  miller: {
    name: "Miller's Law",
    application: "Group features in sets of 3-5. Never list more than 7 bullets.",
  },
  vonRestorff: {
    name: "Von Restorff Effect",
    application: "Make the primary CTA visually distinct from everything else on the page.",
  },
  zeigarnik: {
    name: "Zeigarnik Effect",
    application: "Progress indicators, onboarding steps, and streaks drive completion behavior.",
  },
  peakEnd: {
    name: "Peak-End Rule",
    application: "Perfect the hero section and the post-conversion confirmation state.",
  },
  serialPosition: {
    name: "Serial Position Effect",
    application: "Put the best feature first and the best testimonial last in any sequence.",
  },
} as const;

export const CODEXOS_DEFAULT_STACK = {
  framework: "React + Vite",
  language: "TypeScript",
  styling: "Tailwind CSS v4",
  animation: "Framer Motion",
  icons: "Lucide React",
  forms: "React Hook Form + Zod",
  backend: "Supabase",
  deployment: "Vercel (web) / Capacitor (mobile)",
} as const;

export const PERFORMANCE_TARGETS = {
  lighthouse: { performance: 95, accessibility: 100, bestPractices: 100, seo: 95 },
  coreWebVitals: { lcp: "< 2.5s", fid: "< 100ms", cls: "< 0.1", inp: "< 200ms" },
  bundle: { initialJS: "< 150kb gzipped", totalCSS: "< 30kb gzipped" },
} as const;
