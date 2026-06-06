export type BrandKey = "vantara" | "skyforgeai" | "bioneer" | "navi" | "codexos" | "custom";
export type DeadlineTier = "rapid" | "standard" | "premium";
export type ComponentType =
  | "hero" | "navbar" | "footer" | "cta" | "card" | "form"
  | "testimonial" | "pricing" | "feature_grid" | "modal"
  | "gallery" | "stats" | "faq" | "timeline" | "custom";

export type ProjectStatus =
  | "brief_received" | "analyzing" | "designing"
  | "generating" | "quality_check" | "complete" | "failed";

export interface DesignBrief {
  projectName: string;
  brand: BrandKey;
  projectGoal: string;
  targetAudience: string;
  keyFeatures: string[];
  aestheticDirectives?: string;
  competitorUrls?: string[];
  userJourney?: string;
  deadlineTier: DeadlineTier;
  clientName?: string;
  projectValue?: number;
}

export interface StrategicBlueprint {
  targetOperatorAnalysis: {
    portrait: string;
    wants: string;
    bounceReasons: string;
    conversionTriggers: string;
    comparingAgainst: string;
  };
  competitivePositioning: {
    competitorStrengths: string[];
    competitorWeaknesses: string[];
    codexosAdvantage: string;
  };
  conversionArchitecture: {
    primaryAction: string;
    trustSignals: string[];
    attentionFlow: string[];
    minimumViableInfo: string;
  };
  appliedDesignLaws: string[];
  performanceContract: {
    lighthouseTarget: number;
    lcpTarget: string;
    clsTarget: string;
    bundleBudget: string;
    imageStrategy: string;
  };
}

export interface ComponentSpec {
  name: string;
  type: ComponentType;
  purpose: string;
  structure: string;
  styling: string;
  interactions: string;
  accessibility: string;
  conversionRole: string;
}

export interface MicroInteraction {
  trigger: "hover" | "click" | "scroll" | "focus" | "load" | "submit";
  element: string;
  animation: string;
  duration: string;
  easing: string;
  purpose: "delight" | "feedback" | "guidance" | "confirmation";
  implementation: "css" | "framer-motion" | "gsap";
}

export interface DesignSystem {
  colorPalette: {
    background: string;
    surface: string;
    border: string;
    accent: string;
    accentSecondary: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    semantic: Record<string, string>;
    rationale: string;
  };
  typography: {
    displayFont: string;
    bodyFont: string;
    monoFont: string;
    scale: Record<string, string>;
    lineHeights: Record<string, string>;
    letterSpacing: Record<string, string>;
  };
  components: ComponentSpec[];
  microInteractions: MicroInteraction[];
  responsiveStrategy: {
    breakpoints: Record<string, string>;
    mobileFirst: string;
    tabletAdaptations: string;
    desktopExpansion: string;
    widescreen: string;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
  type: "tsx" | "ts" | "css" | "json" | "md";
  description: string;
}

export interface QualityGateResult {
  conversion: Record<string, boolean>;
  design: Record<string, boolean>;
  performance: Record<string, boolean>;
  brand: Record<string, boolean>;
  passed: boolean;
  failedChecks: string[];
}

export interface DesignGenerationOutput {
  projectId: string;
  brief: DesignBrief;
  blueprint: StrategicBlueprint;
  designSystem: DesignSystem;
  files: GeneratedFile[];
  qualityGate: QualityGateResult;
}
