// THE AGENCY — complete specialist roster from KaiyzerCal/agency-agents
// 182 agents across 15 divisions. Content fetched on-demand from raw GitHub.

export interface AgencyDivision {
  id: string;
  label: string;
  emoji: string;
  color: string;        // tailwind color token (text-{color})
  bgColor: string;      // tailwind bg token (bg-{color}/10)
  borderColor: string;  // tailwind border token
}

export interface AgencyAgent {
  id: string;           // unique — "{div}/{file}"
  file: string;         // filename with .md
  division: string;     // division id
  name: string;         // human-readable
  rawUrl: string;       // raw.githubusercontent.com URL
}

export const DIVISIONS: AgencyDivision[] = [
  { id: "engineering",        label: "Engineering",        emoji: "⚙️",  color: "text-violet-400",  bgColor: "bg-violet-500/10",  borderColor: "border-violet-500/30" },
  { id: "design",             label: "Design",             emoji: "🎨",  color: "text-pink-400",    bgColor: "bg-pink-500/10",    borderColor: "border-pink-500/30" },
  { id: "marketing",          label: "Marketing",          emoji: "📣",  color: "text-orange-400",  bgColor: "bg-orange-500/10",  borderColor: "border-orange-500/30" },
  { id: "sales",              label: "Sales",              emoji: "💼",  color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30" },
  { id: "product",            label: "Product",            emoji: "📦",  color: "text-blue-400",    bgColor: "bg-blue-500/10",    borderColor: "border-blue-500/30" },
  { id: "project-management", label: "Project Mgmt",      emoji: "📋",  color: "text-amber-400",   bgColor: "bg-amber-500/10",   borderColor: "border-amber-500/30" },
  { id: "testing",            label: "Testing",            emoji: "🧪",  color: "text-lime-400",    bgColor: "bg-lime-500/10",    borderColor: "border-lime-500/30" },
  { id: "security",           label: "Security",           emoji: "🔐",  color: "text-red-400",     bgColor: "bg-red-500/10",     borderColor: "border-red-500/30" },
  { id: "support",            label: "Support",            emoji: "🎧",  color: "text-cyan-400",    bgColor: "bg-cyan-500/10",    borderColor: "border-cyan-500/30" },
  { id: "spatial-computing",  label: "Spatial / XR",      emoji: "🥽",  color: "text-indigo-400",  bgColor: "bg-indigo-500/10",  borderColor: "border-indigo-500/30" },
  { id: "game-development",   label: "Game Dev",           emoji: "🎮",  color: "text-purple-400",  bgColor: "bg-purple-500/10",  borderColor: "border-purple-500/30" },
  { id: "academic",           label: "Academic",           emoji: "🎓",  color: "text-teal-400",    bgColor: "bg-teal-500/10",    borderColor: "border-teal-500/30" },
  { id: "gis",                label: "GIS / Geospatial",   emoji: "🗺️",  color: "text-green-400",   bgColor: "bg-green-500/10",   borderColor: "border-green-500/30" },
  { id: "finance",            label: "Finance",            emoji: "💰",  color: "text-yellow-400",  bgColor: "bg-yellow-500/10",  borderColor: "border-yellow-500/30" },
  { id: "specialized",        label: "Specialized",        emoji: "✨",  color: "text-rose-400",    bgColor: "bg-rose-500/10",    borderColor: "border-rose-500/30" },
];

const BASE = "https://raw.githubusercontent.com/KaiyzerCal/agency-agents/main";

function toName(division: string, file: string): string {
  let s = file.replace(".md", "");
  // strip leading category prefix if present (e.g. "engineering-" from division "engineering")
  const divPrefix = division.replace(/-/g, "-") + "-";
  if (s.startsWith(divPrefix)) s = s.slice(divPrefix.length);
  // title case
  return s.split("-").map(w => {
    // preserve known acronyms/brands
    const up = w.toUpperCase();
    if (["ai","ml","ui","ux","xr","gis","bim","sre","cms","seo","pr","hr","iot","sdk","api","qa","ma","fpa","esg","lsp","zk","mcp"].includes(w.toLowerCase())) return up;
    if (["visionos","macos","wechat","tiktok","bilibili","kuaishou","zhihu","xiaohongshu","weibo","douyin","feishu"].includes(w.toLowerCase())) return w.charAt(0).toUpperCase() + w.slice(1);
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

function makeAgents(division: string, files: string[]): AgencyAgent[] {
  return files.map(file => ({
    id: `${division}/${file}`,
    file,
    division,
    name: toName(division, file),
    rawUrl: `${BASE}/${division}/${file}`,
  }));
}

export const AGENTS: AgencyAgent[] = [
  ...makeAgents("engineering", [
    "engineering-ai-data-remediation-engineer.md",
    "engineering-ai-engineer.md",
    "engineering-autonomous-optimization-architect.md",
    "engineering-backend-architect.md",
    "engineering-cms-developer.md",
    "engineering-code-reviewer.md",
    "engineering-codebase-onboarding-engineer.md",
    "engineering-data-engineer.md",
    "engineering-database-optimizer.md",
    "engineering-devops-automator.md",
    "engineering-drupal-shopping-cart.md",
    "engineering-email-intelligence-engineer.md",
    "engineering-embedded-firmware-engineer.md",
    "engineering-feishu-integration-developer.md",
    "engineering-filament-optimization-specialist.md",
    "engineering-frontend-developer.md",
    "engineering-git-workflow-master.md",
    "engineering-incident-response-commander.md",
    "engineering-it-service-manager.md",
    "engineering-minimal-change-engineer.md",
    "engineering-mobile-app-builder.md",
    "engineering-multi-agent-systems-architect.md",
    "engineering-network-engineer.md",
    "engineering-orgscript-engineer.md",
    "engineering-prompt-engineer.md",
    "engineering-rapid-prototyper.md",
    "engineering-senior-developer.md",
    "engineering-software-architect.md",
    "engineering-solidity-smart-contract-engineer.md",
    "engineering-sre.md",
    "engineering-technical-writer.md",
    "engineering-voice-ai-integration-engineer.md",
    "engineering-wechat-mini-program-developer.md",
    "engineering-wordpress-shopping-cart.md",
  ]),
  ...makeAgents("design", [
    "design-brand-guardian.md",
    "design-image-prompt-engineer.md",
    "design-inclusive-visuals-specialist.md",
    "design-persona-walkthrough.md",
    "design-ui-designer.md",
    "design-ux-architect.md",
    "design-ux-researcher.md",
    "design-visual-storyteller.md",
    "design-whimsy-injector.md",
  ]),
  ...makeAgents("marketing", [
    "marketing-aeo-foundations.md",
    "marketing-agentic-search-optimizer.md",
    "marketing-ai-citation-strategist.md",
    "marketing-app-store-optimizer.md",
    "marketing-baidu-seo-specialist.md",
    "marketing-bilibili-content-strategist.md",
    "marketing-book-co-author.md",
    "marketing-carousel-growth-engine.md",
    "marketing-china-ecommerce-operator.md",
    "marketing-china-market-localization-strategist.md",
    "marketing-content-creator.md",
    "marketing-cross-border-ecommerce.md",
    "marketing-douyin-strategist.md",
    "marketing-email-strategist.md",
    "marketing-global-podcast-strategist.md",
    "marketing-growth-hacker.md",
    "marketing-instagram-curator.md",
    "marketing-kuaishou-strategist.md",
    "marketing-linkedin-content-creator.md",
    "marketing-livestream-commerce-coach.md",
    "marketing-multi-platform-publisher.md",
    "marketing-podcast-strategist.md",
    "marketing-pr-communications-manager.md",
    "marketing-private-domain-operator.md",
    "marketing-reddit-community-builder.md",
    "marketing-seo-specialist.md",
    "marketing-short-video-editing-coach.md",
    "marketing-social-media-strategist.md",
    "marketing-tiktok-strategist.md",
    "marketing-twitter-engager.md",
    "marketing-video-optimization-specialist.md",
    "marketing-wechat-official-account.md",
    "marketing-weibo-strategist.md",
    "marketing-x-twitter-intelligence-analyst.md",
    "marketing-xiaohongshu-specialist.md",
    "marketing-zhihu-strategist.md",
  ]),
  ...makeAgents("sales", [
    "sales-account-strategist.md",
    "sales-coach.md",
    "sales-deal-strategist.md",
    "sales-discovery-coach.md",
    "sales-engineer.md",
    "sales-offer-lead-gen-strategist.md",
    "sales-outbound-strategist.md",
    "sales-pipeline-analyst.md",
    "sales-proposal-strategist.md",
  ]),
  ...makeAgents("product", [
    "product-behavioral-nudge-engine.md",
    "product-feedback-synthesizer.md",
    "product-manager.md",
    "product-sprint-prioritizer.md",
    "product-trend-researcher.md",
  ]),
  ...makeAgents("project-management", [
    "project-management-experiment-tracker.md",
    "project-management-jira-workflow-steward.md",
    "project-management-meeting-notes-specialist.md",
    "project-management-project-shepherd.md",
    "project-management-studio-operations.md",
    "project-management-studio-producer.md",
    "project-manager-senior.md",
  ]),
  ...makeAgents("testing", [
    "testing-accessibility-auditor.md",
    "testing-api-tester.md",
    "testing-evidence-collector.md",
    "testing-performance-benchmarker.md",
    "testing-reality-checker.md",
    "testing-test-results-analyzer.md",
    "testing-tool-evaluator.md",
    "testing-workflow-optimizer.md",
  ]),
  ...makeAgents("security", [
    "security-appsec-engineer.md",
    "security-architect.md",
    "security-blockchain-security-auditor.md",
    "security-cloud-security-architect.md",
    "security-compliance-auditor.md",
    "security-incident-responder.md",
    "security-penetration-tester.md",
    "security-senior-secops.md",
    "security-threat-detection-engineer.md",
    "security-threat-intelligence-analyst.md",
  ]),
  ...makeAgents("support", [
    "support-analytics-reporter.md",
    "support-executive-summary-generator.md",
    "support-finance-tracker.md",
    "support-infrastructure-maintainer.md",
    "support-legal-compliance-checker.md",
    "support-support-responder.md",
  ]),
  ...makeAgents("spatial-computing", [
    "macos-spatial-metal-engineer.md",
    "terminal-integration-specialist.md",
    "visionos-spatial-engineer.md",
    "xr-cockpit-interaction-specialist.md",
    "xr-immersive-developer.md",
    "xr-interface-architect.md",
  ]),
  ...makeAgents("game-development", [
    "game-audio-engineer.md",
    "game-designer.md",
    "level-designer.md",
    "narrative-designer.md",
    "technical-artist.md",
  ]),
  ...makeAgents("academic", [
    "academic-anthropologist.md",
    "academic-geographer.md",
    "academic-historian.md",
    "academic-narratologist.md",
    "academic-psychologist.md",
  ]),
  ...makeAgents("gis", [
    "gis-3d-scene-developer.md",
    "gis-analyst.md",
    "gis-bim-specialist.md",
    "gis-cartography-designer.md",
    "gis-drone-reality-mapping.md",
    "gis-geoai-ml-engineer.md",
    "gis-geoprocessing-specialist.md",
    "gis-qa-engineer.md",
    "gis-solution-engineer.md",
    "gis-spatial-data-engineer.md",
    "gis-spatial-data-scientist.md",
    "gis-technical-consultant.md",
    "gis-web-gis-developer.md",
  ]),
  ...makeAgents("finance", [
    "finance-bookkeeper-controller.md",
    "finance-financial-analyst.md",
    "finance-fpa-analyst.md",
    "finance-investment-researcher.md",
    "finance-tax-strategist.md",
  ]),
  ...makeAgents("specialized", [
    "accounts-payable-agent.md",
    "agentic-identity-trust.md",
    "agents-orchestrator.md",
    "automation-governance-architect.md",
    "business-strategist.md",
    "change-management-consultant.md",
    "chief-financial-officer.md",
    "corporate-training-designer.md",
    "customer-service.md",
    "customer-success-manager.md",
    "data-consolidation-agent.md",
    "data-privacy-officer.md",
    "esg-sustainability-officer.md",
    "government-digital-presales-consultant.md",
    "grant-writer.md",
    "healthcare-customer-service.md",
    "healthcare-marketing-compliance.md",
    "hospitality-guest-services.md",
    "hr-onboarding.md",
    "identity-graph-operator.md",
    "language-translator.md",
    "legal-billing-time-tracking.md",
    "legal-client-intake.md",
    "legal-document-review.md",
    "loan-officer-assistant.md",
    "lsp-index-engineer.md",
    "ma-integration-manager.md",
    "medical-billing-coding-specialist.md",
    "operations-manager.md",
    "organizational-psychologist.md",
    "personal-growth-mentor.md",
    "real-estate-buyer-seller.md",
    "recruitment-specialist.md",
    "report-distribution-agent.md",
    "retail-customer-returns.md",
    "sales-data-extraction-agent.md",
    "sales-outreach.md",
    "specialized-chief-of-staff.md",
    "specialized-civil-engineer.md",
    "specialized-cultural-intelligence-strategist.md",
    "specialized-developer-advocate.md",
    "specialized-document-generator.md",
    "specialized-french-consulting-market.md",
    "specialized-korean-business-navigator.md",
    "specialized-mcp-builder.md",
    "specialized-model-qa.md",
    "specialized-pricing-analyst.md",
    "specialized-salesforce-architect.md",
    "specialized-strategy-duel-agent.md",
    "specialized-workflow-architect.md",
    "study-abroad-advisor.md",
    "supply-chain-strategist.md",
    "zk-steward.md",
  ]),
];

export function getDivision(id: string): AgencyDivision | undefined {
  return DIVISIONS.find(d => d.id === id);
}

export function getAgentsByDivision(divId: string): AgencyAgent[] {
  return AGENTS.filter(a => a.division === divId);
}
