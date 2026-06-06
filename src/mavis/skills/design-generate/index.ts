import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { runDesignEngine } from "../../design/designEngine";
import type { DesignBrief } from "../../design/types";

const BRANDS = ["vantara", "skyforgeai", "bioneer", "navi", "codexos", "custom"] as const;

function extractBrand(input: string): DesignBrief["brand"] {
  const lower = input.toLowerCase();
  if (lower.includes("skyforge")) return "skyforgeai";
  if (lower.includes("bioneer")) return "bioneer";
  if (lower.includes("navi")) return "navi";
  if (lower.includes("vantara")) return "vantara";
  if (lower.includes("codexos")) return "codexos";
  return "custom";
}

function extractProjectName(input: string): string {
  const patterns = [
    /build\s+(?:me\s+)?(?:a\s+)?([A-Z][a-zA-Z0-9\s]+?)(?:\s+(?:landing|website|site|page|component|UI))/i,
    /(?:landing|website|site|page)\s+for\s+([A-Z][a-zA-Z0-9\s]+?)(?:\s|,|\.)/i,
    /design\s+(?:a\s+)?([A-Z][a-zA-Z0-9\s]+?)(?:\s+(?:landing|website|site|page|component))/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  // Fall back to brand name + type
  const brand = extractBrand(input);
  if (brand !== "custom") return `${brand.charAt(0).toUpperCase() + brand.slice(1)} Site`;
  return "Untitled Project";
}

const handler: SkillHandler = async (ctx, input) => {
  if (!input || input.trim().length < 10) {
    return {
      skillName: "design-generate",
      output: `I need a design brief to generate a site. Tell me:

1. **Project Goal** — What is this site for? What action should a visitor take?
2. **Target Audience** — Who lands on this page? What's their pain?
3. **Key Features** — What sections must it include?
4. **Brand** — CODEXOS / SkyforgeAI / Bioneer / NAVI / VANTARA / Custom?
5. **Competitors** — Any sites I should analyze and surpass?
6. **User Journey** — Land → Understand → Trust → Convert?

Give me these and I will generate a complete production site.`,
    };
  }

  const userId = ctx.userId;
  if (!userId) {
    return {
      skillName: "design-generate",
      output: "Authentication required to run the design engine.",
    };
  }

  const brief: DesignBrief = {
    projectName:  extractProjectName(input),
    brand:        extractBrand(input),
    projectGoal:  input,
    targetAudience: "Extracted from conversation context",
    keyFeatures:  [],
    deadlineTier: "standard",
  };

  try {
    const result = await runDesignEngine(userId, brief);

    const fileList = result.files.map((f) => `  • ${f.path}`).join("\n");
    const failed   = result.qualityGate.failedChecks;
    const status   = result.qualityGate.passed
      ? "✅ All quality checks passed"
      : `⚠ ${failed.length} check${failed.length !== 1 ? "s" : ""} need attention`;

    return {
      skillName: "design-generate",
      output: `⚡ DESIGN GENERATION COMPLETE

PROJECT: ${brief.projectName}
STATUS: ${status}
BRAND: ${brief.brand}

PRIMARY ACTION: ${result.blueprint.conversionArchitecture?.primaryAction ?? "—"}

GENERATED FILES:
${fileList}
${failed.length > 0 ? `\nQUALITY NOTES:\n${failed.map((c) => `  • ${c}`).join("\n")}` : ""}

Project saved to your MAVIS Design Library. View it in the Design Studio → /design-studio`,
      data: result,
    };
  } catch (err) {
    return {
      skillName: "design-generate",
      output: `Design engine error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill(
  {
    name: "design-generate",
    description: "Generates production-ready websites and React components from a design brief. Applies CODEXOS brand standards, design psychology laws, and outputs deployable TypeScript/Tailwind code.",
    keywords: [
      "build a website", "create a landing page", "design a page",
      "build a component", "generate a site", "create a hero section",
      "build a pricing page", "design system", "make a website",
      "build me a site", "create a UI", "generate components",
      "skyforgeai landing", "bioneer site", "navi landing",
      "landing page", "design studio", "generate website",
      "build landing", "create site",
    ],
  },
  handler,
);

export { BRANDS };
