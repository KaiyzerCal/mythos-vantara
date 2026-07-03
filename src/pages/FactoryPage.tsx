// ============================================================
// VANTARA.EXE — Factory Floor v3 (MAVIS Civilization Engine)
// Full Factorio-style: ore patches, mining drills, belt networks,
// assembly machines, inserters, workers, train, storage chests.
// Every element maps to a real MAVIS system with live DB data.
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

// ─── Canvas constants ──────────────────────────────────────
const TILE = 32;
const V_COLS = 72;
const V_ROWS = 52;

// ─── Types ──────────────────────────────────────────────────
type MachineStatus = "active" | "warm" | "idle";
type OreType = "iron" | "copper" | "coal" | "stone" | "memory" | "quest" | "oil";
type BeltType = "h-right" | "h-left" | "v-down" | "v-up" | "corner-ne" | "corner-nw" | "corner-se" | "corner-sw";

interface FactoryState {
  mavis: MachineStatus; memory: MachineStatus; journal: MachineStatus;
  quest: MachineStatus; ruview: MachineStatus; orders: MachineStatus;
  personas: { id: string; name: string; role: string }[];
  councils: { id: string; name: string }[];
  activeQuests: number; activeOrders: number; memoryCount: number;
  journalCount: number; goalCount: number; taskCount: number;
}

interface OrePatch { col: number; row: number; w: number; h: number; type: OreType; label: string; systemLabel: string; }
interface MiningDrill { col: number; row: number; orePatch: OreType; label: string; }
interface BeltSeg { col: number; row: number; type: BeltType; speed: "yellow" | "red" | "blue"; }
interface PowerPole { col: number; row: number; }
interface BeltItem {
  x: number; y: number; path: { x: number; y: number }[];
  pathIdx: number; color: string; speed: number; opacity: number;
  fading: boolean; label: string; size: number;
}
interface Smoke { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string; }
interface Worker { x: number; y: number; path: { x: number; y: number }[]; pathIdx: number; speed: number; frame: number; facingRight: boolean; }
interface Inserter { pivotCol: number; pivotRow: number; srcAngle: number; dstAngle: number; itemColor: string; active: boolean; }
interface AssemblyMachine {
  col: number; row: number; w: number; h: number;
  label: string; sublabel: string;
  bodyColor: string; accentColor: string; lightColor: string;
  statusKey: keyof FactoryState; isMAVIS?: boolean;
  systemName: string;
}

// ─── Ore patch data ────────────────────────────────────────
const ORE_PATCHES: OrePatch[] = [
  { col: 0,  row: 1, w: 4, h: 3, type: "iron",   label: "Memory / Journal",   systemLabel: "mavis_notes · journal_entries" },
  { col: 6,  row: 0, w: 4, h: 3, type: "copper", label: "Quests / Goals",     systemLabel: "mavis_goals · quests" },
  { col: 12, row: 1, w: 3, h: 3, type: "coal",   label: "Standing Orders",    systemLabel: "standup_order_templates" },
  { col: 17, row: 0, w: 3, h: 3, type: "stone",  label: "Health / Bio Data",  systemLabel: "health_metrics · wearables" },
  { col: 21, row: 1, w: 3, h: 2, type: "oil",    label: "Finance / Leads",    systemLabel: "mavis_finances · mavis_leads" },
  { col: 0,  row: 6, w: 3, h: 2, type: "memory", label: "Deep Memory",        systemLabel: "mavis_agent_memories" },
  { col: 6,  row: 6, w: 3, h: 2, type: "quest",  label: "Active Quests",      systemLabel: "quests (active)" },
  { col: 12, row: 6, w: 2, h: 2, type: "iron",   label: "Activity Log",       systemLabel: "activity_log" },
];

const ORE_COLORS: Record<OreType, string> = {
  iron: "#3a5a7a", copper: "#a05030", coal: "#1e2830",
  stone: "#6a6055", memory: "#1a2a5a", quest: "#5a3a00", oil: "#1a3a1a",
};
const ORE_ROCK_COLORS: Record<OreType, string> = {
  iron: "#5588aa", copper: "#cc6633", coal: "#2a3040",
  stone: "#8a8070", memory: "#2244aa", quest: "#886600", oil: "#336633",
};

// ─── Mining drills ─────────────────────────────────────────
const MINING_DRILLS: MiningDrill[] = [
  { col: 0,  row: 1, orePatch: "iron",   label: "GMAIL-SYNC" },
  { col: 2,  row: 1, orePatch: "iron",   label: "GDRIVE-SYNC" },
  { col: 6,  row: 0, orePatch: "copper", label: "CAL-SYNC" },
  { col: 8,  row: 0, orePatch: "copper", label: "NOTION-SYNC" },
  { col: 12, row: 1, orePatch: "coal",   label: "HEARTBEAT" },
  { col: 17, row: 0, orePatch: "stone",  label: "HEALTH-MON" },
  { col: 21, row: 1, orePatch: "oil",    label: "PLAID-SYNC" },
  { col: 0,  row: 6, orePatch: "memory", label: "MEM-EMBED" },
  { col: 6,  row: 6, orePatch: "quest",  label: "GOAL-ENG" },
];

// ─── Belt network ──────────────────────────────────────────
function buildBeltNetwork(): BeltSeg[] {
  const belts: BeltSeg[] = [];
  // Feeder belts from drills → main spine
  [1, 3, 7, 9, 13, 18, 22, 1, 7].forEach((col, i) => {
    const startRow = i >= 7 ? 8 : 4;
    for (let r = startRow; r <= 9; r++)
      belts.push({ col, row: r, type: "v-down", speed: "yellow" });
    belts.push({ col, row: 10, type: "corner-se", speed: "yellow" });
  });
  // Main spine (west → MAVIS): row 10, cols 2-22, red belt going east
  for (let c = 2; c <= 22; c++) belts.push({ col: c, row: 10, type: "h-right", speed: "red" });
  // MAVIS output spine east: row 10, cols 33-60, blue belt
  for (let c = 33; c <= 58; c++) belts.push({ col: c, row: 10, type: "h-right", speed: "blue" });
  // Return belt row 12, going west
  for (let c = 5; c <= 24; c++) belts.push({ col: c, row: 12, type: "h-left", speed: "yellow" });
  belts.push({ col: 4, row: 12, type: "corner-sw", speed: "yellow" });
  // Persona district feeder (col 4 going south)
  for (let r = 12; r <= 30; r++) belts.push({ col: 4, row: r, type: "v-down", speed: "yellow" });
  // Council district feeder (col 57 going south)
  for (let c = 34; c <= 56; c++) belts.push({ col: c, row: 12, type: "h-right", speed: "yellow" });
  belts.push({ col: 57, row: 12, type: "corner-se", speed: "yellow" });
  for (let r = 13; r <= 30; r++) belts.push({ col: 57, row: r, type: "v-down", speed: "yellow" });
  // Output belt at row 15 (blue)
  for (let c = 34; c <= 55; c++) belts.push({ col: c, row: 15, type: "h-right", speed: "blue" });
  // Storage feeders
  [42, 46, 50, 54].forEach(c => {
    for (let r = 16; r <= 18; r++) belts.push({ col: c, row: r, type: "v-down", speed: "yellow" });
  });
  return belts;
}

const BELT_NETWORK = buildBeltNetwork();

// ─── Assembly machines ─────────────────────────────────────
const ASSEMBLY_MACHINES: AssemblyMachine[] = [
  // MAVIS PRIME – center
  { col: 24, row: 4, w: 7, h: 9, label: "MAVIS PRIME", sublabel: "CODEXOS CORE",
    bodyColor: "#130d2a", accentColor: "#6b21d8", lightColor: "#a855f7",
    statusKey: "mavis", isMAVIS: true, systemName: "mavis-agent · mavis-chat" },
  // Left processors
  { col: 19, row: 4, w: 3, h: 3, label: "MEM·PROC", sublabel: "consolidate",
    bodyColor: "#0d1a2a", accentColor: "#2255aa", lightColor: "#4488ff",
    statusKey: "memory", systemName: "mavis-memory-consolidate" },
  { col: 19, row: 8, w: 3, h: 3, label: "JOURNAL", sublabel: "auto-log",
    bodyColor: "#100820", accentColor: "#5522aa", lightColor: "#aa44ff",
    statusKey: "journal", systemName: "mavis-auto-journal" },
  // Right processors
  { col: 32, row: 4, w: 3, h: 3, label: "QUEST·HUB", sublabel: "goal-agent",
    bodyColor: "#1a1000", accentColor: "#885500", lightColor: "#ffaa00",
    statusKey: "quest", systemName: "mavis-goal-agent" },
  { col: 32, row: 8, w: 3, h: 3, label: "RUVIEW", sublabel: "biometrics",
    bodyColor: "#001a1a", accentColor: "#007766", lightColor: "#00ffcc",
    statusKey: "ruview", systemName: "mavis-health-monitor" },
  { col: 32, row: 12, w: 3, h: 3, label: "ORDERS·PROC", sublabel: "so-engine",
    bodyColor: "#1a0a00", accentColor: "#884400", lightColor: "#ff8800",
    statusKey: "orders", systemName: "mavis-autonomous-engine" },
  // Output cluster
  { col: 36, row: 3, w: 4, h: 4, label: "PERSONA·FORGE", sublabel: "mavis-persona-forge",
    bodyColor: "#001a08", accentColor: "#117733", lightColor: "#44ff88",
    statusKey: "mavis", systemName: "mavis-persona-forge" },
  { col: 41, row: 3, w: 4, h: 4, label: "COMM·HUB", sublabel: "email·sms·tel",
    bodyColor: "#1a0808", accentColor: "#993311", lightColor: "#ff6644",
    statusKey: "mavis", systemName: "mavis-email-send · mavis-sms" },
  { col: 46, row: 3, w: 4, h: 4, label: "CONTENT", sublabel: "nora·pipeline",
    bodyColor: "#100a00", accentColor: "#996600", lightColor: "#ffcc00",
    statusKey: "mavis", systemName: "mavis-content-pipeline" },
  { col: 36, row: 8, w: 4, h: 4, label: "INTEL·CORE", sublabel: "world-model",
    bodyColor: "#001a04", accentColor: "#116633", lightColor: "#33ee66",
    statusKey: "mavis", systemName: "mavis-world-model · mavis-market-radar" },
  { col: 41, row: 8, w: 4, h: 4, label: "AUTO·ENGINE", sublabel: "trigger·runner",
    bodyColor: "#05050e", accentColor: "#443388", lightColor: "#8866ff",
    statusKey: "mavis", systemName: "mavis-trigger-engine · mavis-autonomous-runner" },
  { col: 46, row: 8, w: 4, h: 4, label: "ANALYTICS", sublabel: "daily-scores",
    bodyColor: "#1a0010", accentColor: "#992244", lightColor: "#ff3366",
    statusKey: "mavis", systemName: "mavis-daily-scores · mavis-eval" },
  { col: 51, row: 3, w: 4, h: 4, label: "CODE·AGENT", sublabel: "browser·github",
    bodyColor: "#0a0a00", accentColor: "#666600", lightColor: "#aaaa00",
    statusKey: "mavis", systemName: "mavis-code-agent · mavis-browser" },
  { col: 51, row: 8, w: 4, h: 4, label: "MEDIA·STUDIO", sublabel: "image·video",
    bodyColor: "#0a0a1a", accentColor: "#3333aa", lightColor: "#7777ff",
    statusKey: "mavis", systemName: "mavis-image-gen · mavis-video-gen" },
];

// ─── Inserters ─────────────────────────────────────────────
const INSERTERS: Inserter[] = [
  { pivotCol: 23, pivotRow: 5,  srcAngle: Math.PI,      dstAngle: 0,             itemColor: "#4488ff", active: true },
  { pivotCol: 23, pivotRow: 9,  srcAngle: Math.PI,      dstAngle: 0,             itemColor: "#aa44ff", active: true },
  { pivotCol: 31, pivotRow: 5,  srcAngle: 0,            dstAngle: Math.PI,       itemColor: "#ffaa00", active: true },
  { pivotCol: 31, pivotRow: 9,  srcAngle: 0,            dstAngle: Math.PI,       itemColor: "#00ffcc", active: true },
  { pivotCol: 27, pivotRow: 13, srcAngle: -Math.PI / 2, dstAngle: Math.PI / 2,  itemColor: "#ffffff",  active: true },
  { pivotCol: 1,  pivotRow: 3,  srcAngle: Math.PI / 2,  dstAngle: -Math.PI / 2, itemColor: "#5588aa", active: true },
  { pivotCol: 7,  pivotRow: 3,  srcAngle: Math.PI / 2,  dstAngle: -Math.PI / 2, itemColor: "#cc6633", active: true },
];

// ─── Power poles ───────────────────────────────────────────
const POWER_POLES: PowerPole[] = [];
for (let c = 0; c <= 65; c += 9) {
  for (let r = 0; r <= 45; r += 9) {
    POWER_POLES.push({ col: c, row: r });
  }
}

// ─── Belt item paths ───────────────────────────────────────
const P = (c: number, r: number) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
const BELT_PATHS: Record<string, { x: number; y: number }[]> = {
  memory: [P(1,2), P(1,10), P(22,10), P(22,6)],
  journal:[P(3,2), P(3,10), P(22,10), P(22,9)],
  quest:  [P(7,1), P(7,10), P(22,10), P(31,10), P(31,5)],
  ruview: [P(18,1),P(18,10),P(22,10), P(31,10), P(31,9)],
  order:  [P(13,2),P(13,10),P(22,10)],
  persona:[P(4,12), P(4,25), P(22,25)],
  council:[P(57,12),P(57,28)],
  output: [P(31,10),P(56,10),P(56,15),P(58,15)],
};

// ─── Worker patrol paths ───────────────────────────────────
const WORKER_PATHS = [
  [P(5,14), P(5,22), P(18,22), P(18,14)],
  [P(30,15), P(45,15), P(45,22), P(30,22)],
  [P(10,28), P(50,28), P(50,36), P(10,36)],
  [P(55,14), P(65,14), P(65,20), P(55,20)],
];

// ─── Seeded random ─────────────────────────────────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

// ─── Color helpers ──────────────────────────────────────────
function lightenColor(hex: string, amount: number): string {
  if (!hex.startsWith("#")) return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (n >> 16) + amount);
  const g = Math.min(255, ((n >> 8) & 0xff) + amount);
  const b = Math.min(255, (n & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}
function darkenColor(hex: string, amount: number): string {
  if (!hex.startsWith("#")) return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

// ─── DRAW FUNCTIONS ─────────────────────────────────────────

function drawTerrain(ctx: CanvasRenderingContext2D, panX: number, panY: number, vw: number, vh: number) {
  const sc = Math.floor(panX / TILE); const ec = Math.min(V_COLS, sc + Math.ceil(vw / TILE) + 2);
  const sr = Math.floor(panY / TILE); const er = Math.min(V_ROWS, sr + Math.ceil(vh / TILE) + 2);
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const n1 = seededRand(c * 137 + r * 251);
      const n2 = seededRand(c * 79  + r * 317 + 1000);
      const n3 = seededRand(c * 199 + r * 53  + 2000);
      const tr = Math.floor(30 + n1 * 14 + n2 * 5);
      const tg = Math.floor(27 + n1 * 10 + n3 * 5);
      const tb = Math.floor(14 + n2 * 10);
      ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
      ctx.fillRect(c * TILE - panX, r * TILE - panY, TILE, TILE);
      if (seededRand(c * 311 + r * 127 + 5555) > 0.87) {
        ctx.fillStyle = `rgba(70,60,30,${0.25 + seededRand(c * 211 + r * 97 + 9999) * 0.3})`;
        ctx.fillRect(c * TILE - panX + 11, r * TILE - panY + 11, 3, 3);
      }
    }
  }
}

function drawOrePatch(ctx: CanvasRenderingContext2D, patch: OrePatch, panX: number, panY: number) {
  const px = patch.col * TILE - panX;
  const py = patch.row * TILE - panY;
  const pw = patch.w * TILE;
  const ph = patch.h * TILE;
  ctx.fillStyle = ORE_COLORS[patch.type];
  ctx.fillRect(px, py, pw, ph);
  // Rock nodes scattered across patch
  for (let dc = 0; dc < patch.w; dc++) {
    for (let dr = 0; dr < patch.h; dr++) {
      const n = seededRand((patch.col + dc) * 71 + (patch.row + dr) * 131);
      if (n > 0.35) {
        const rx = px + dc * TILE + TILE * 0.15 + seededRand(dc * 13 + dr * 7) * TILE * 0.5;
        const ry = py + dr * TILE + TILE * 0.15 + seededRand(dc * 7 + dr * 17) * TILE * 0.5;
        const rw = 6 + n * 10; const rh = 4 + n * 8;
        ctx.fillStyle = ORE_ROCK_COLORS[patch.type];
        ctx.fillRect(rx, ry, rw, rh);
        ctx.fillStyle = lightenColor(ORE_ROCK_COLORS[patch.type], 25);
        ctx.fillRect(rx, ry, rw * 0.4, rh * 0.4);
      }
    }
  }
  // Patch label
  ctx.fillStyle = "rgba(255,255,200,0.55)";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText(patch.label, px + pw / 2, py + ph - 4);
}

function drawMiningDrill(
  ctx: CanvasRenderingContext2D, drill: MiningDrill,
  pistonOffset: number, panX: number, panY: number
) {
  const px = drill.col * TILE - panX;
  const py = drill.row * TILE - panY;
  const W  = 2 * TILE; const H = 2 * TILE;
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(px + 3, py + 3, W, H);
  // Body
  const grad = ctx.createLinearGradient(px, py, px, py + H);
  grad.addColorStop(0, "#2a2a22"); grad.addColorStop(1, "#1a1a14");
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, W, H);
  ctx.strokeStyle = "#4a4a3a"; ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 0.75, py + 0.75, W - 1.5, H - 1.5);
  // Piston
  const pistonH = 8 + pistonOffset * 8;
  ctx.fillStyle = "#667788"; ctx.fillRect(px + W / 2 - 4, py + H - pistonH - 6, 8, pistonH);
  ctx.fillStyle = "#889966"; ctx.fillRect(px + W / 2 - 5, py + H - 8, 10, 8);
  // Drill bit
  ctx.fillStyle = "#aabb88";
  ctx.beginPath();
  ctx.moveTo(px + W / 2, py + H + pistonOffset * 4);
  ctx.lineTo(px + W / 2 - 5, py + H - 5);
  ctx.lineTo(px + W / 2 + 5, py + H - 5);
  ctx.fill();
  // Status light
  ctx.fillStyle = "#00ff88"; ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.arc(px + W - 6, py + 6, 3, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Label
  ctx.fillStyle = "rgba(255,255,200,0.85)"; ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText(drill.label, px + W / 2, py + H / 2 - 2);
}

function drawBeltSegments(ctx: CanvasRenderingContext2D, belts: BeltSeg[], animOffset: number, panX: number, panY: number, vw: number, vh: number) {
  const BELT_COLORS: Record<string, string> = { yellow: "#a08010", red: "#882020", blue: "#102088" };
  const BELT_STRIPE: Record<string, string> = { yellow: "#c0a020", red: "#aa3030", blue: "#2040aa" };
  for (const belt of belts) {
    const px = belt.col * TILE - panX;
    const py = belt.row * TILE - panY;
    if (px + TILE < 0 || px > vw || py + TILE < 0 || py > vh) continue;
    // Belt base
    ctx.fillStyle = BELT_COLORS[belt.speed];
    ctx.fillRect(px, py, TILE, TILE);
    // Animated stripes
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, TILE, TILE); ctx.clip();
    const stripeColor = BELT_STRIPE[belt.speed];
    ctx.strokeStyle = stripeColor; ctx.lineWidth = 3; ctx.globalAlpha = 0.6;
    const isH = belt.type === "h-right" || belt.type === "h-left";
    if (isH) {
      const dir = belt.type === "h-right" ? 1 : -1;
      const off = ((animOffset * dir * 0.8) % (TILE * 0.5) + TILE * 0.5) % (TILE * 0.5);
      for (let i = -1; i <= 3; i++) {
        const x0 = px + i * TILE * 0.5 + off * dir;
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x0 + TILE * 0.3, py + TILE); ctx.stroke();
      }
    } else {
      const dir = belt.type === "v-down" ? 1 : -1;
      const off = ((animOffset * dir * 0.8) % (TILE * 0.5) + TILE * 0.5) % (TILE * 0.5);
      for (let i = -1; i <= 3; i++) {
        const y0 = py + i * TILE * 0.5 + off * dir;
        ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px + TILE, y0 + TILE * 0.3); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.restore();
    // Center line
    ctx.strokeStyle = BELT_STRIPE[belt.speed]; ctx.lineWidth = 1; ctx.globalAlpha = 0.4;
    if (isH) { ctx.beginPath(); ctx.moveTo(px, py + TILE / 2); ctx.lineTo(px + TILE, py + TILE / 2); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(px + TILE / 2, py); ctx.lineTo(px + TILE / 2, py + TILE); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // Edge rails
    ctx.fillStyle = "#3a3a30"; ctx.fillRect(px, py, TILE, 3); ctx.fillRect(px, py + TILE - 3, TILE, 3);
  }
}

function drawGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle: number, fill: string) {
  const teeth = 10; const innerR = r * 0.62; const tw = (Math.PI * 2 / teeth) * 0.38;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
  ctx.fillStyle = fill; ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    ctx.moveTo(Math.cos(a - tw) * innerR, Math.sin(a - tw) * innerR);
    ctx.lineTo(Math.cos(a - tw) * (r + r * 0.28), Math.sin(a - tw) * (r + r * 0.28));
    ctx.lineTo(Math.cos(a + tw) * (r + r * 0.28), Math.sin(a + tw) * (r + r * 0.28));
    ctx.lineTo(Math.cos(a + tw) * innerR, Math.sin(a + tw) * innerR);
    ctx.arc(0, 0, innerR, a + tw, (i + 1) / teeth * Math.PI * 2 - tw);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lightenColor(fill, 30);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawAssemblyMachine(
  ctx: CanvasRenderingContext2D, m: AssemblyMachine,
  status: MachineStatus, tick: number, panX: number, panY: number
) {
  const px = m.col * TILE - panX;
  const py = m.row * TILE - panY;
  const W  = m.w * TILE; const H = m.h * TILE;

  if (m.isMAVIS) {
    // MAVIS PRIME — special rendering
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(px + 5, py + 5, W, H);
    const grad = ctx.createLinearGradient(px, py, px, py + H);
    grad.addColorStop(0, "#1a0d3a"); grad.addColorStop(0.5, "#130d2a"); grad.addColorStop(1, "#0d0820");
    ctx.fillStyle = grad; ctx.fillRect(px, py, W, H);
    const glow = 0.6 + 0.4 * Math.sin(tick * 0.07);
    ctx.shadowColor = "#8b5cf6"; ctx.shadowBlur = 14 * glow;
    ctx.strokeStyle = "#6b21d8"; ctx.lineWidth = 2.5;
    ctx.strokeRect(px + 1, py + 1, W - 2, H - 2); ctx.shadowBlur = 0;
    const hg = ctx.createLinearGradient(px, py, px + W, py);
    hg.addColorStop(0, "#6b21d8"); hg.addColorStop(0.5, "#9333ea"); hg.addColorStop(1, "#6b21d8");
    ctx.fillStyle = hg; ctx.fillRect(px, py, W, 5);
    const cx = px + W / 2; const cy = py + H / 2 - 15;
    const ga = (tick * 0.04) % (Math.PI * 2);
    drawGear(ctx, cx, cy, 24, ga, "#4a1090");
    drawGear(ctx, cx, cy, 14, -ga * 1.5, "#6b21d8");
    ctx.globalAlpha = glow; ctx.fillStyle = "#a855f7";
    ctx.shadowColor = "#a855f7"; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const age = (tick + i * 20) % 60;
      ctx.globalAlpha = Math.max(0, 0.3 - age / 60 * 0.3);
      ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, age * 3 + 28, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const sy = ((tick * 0.5) % H);
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#a855f7"; ctx.fillRect(px, py + sy, W, 4); ctx.globalAlpha = 1;
    ctx.fillStyle = "#c084fc"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
    ctx.fillText("MAVIS PRIME", cx, py + H - 24);
    ctx.fillStyle = "#7c3aed"; ctx.font = "7px monospace";
    ctx.fillText("CODEXOS · " + m.sublabel, cx, py + H - 13);
    ctx.fillStyle = `rgba(168,85,247,${glow})`;
    ctx.fillText("● ACTIVE", cx, py + H - 4);
    return;
  }

  // Standard assembly machine
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(px + 3, py + 3, W, H);
  const grad = ctx.createLinearGradient(px, py, px, py + H);
  grad.addColorStop(0, lightenColor(m.bodyColor, 14)); grad.addColorStop(1, m.bodyColor);
  ctx.fillStyle = grad; ctx.fillRect(px, py, W, H);
  ctx.strokeStyle = m.accentColor; ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 0.75, py + 0.75, W - 1.5, H - 1.5);
  ctx.fillStyle = m.accentColor; ctx.fillRect(px, py, W, 4);

  // Status light
  const lightA = status === "active" ? 0.65 + 0.35 * Math.sin(tick * 0.09 + m.col) : status === "warm" ? 0.45 : 0.15;
  ctx.globalAlpha = lightA; ctx.fillStyle = m.lightColor;
  ctx.shadowColor = m.lightColor; ctx.shadowBlur = status === "active" ? 8 : 0;
  ctx.beginPath(); ctx.arc(px + W - 8, py + 12, 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  // Mini gear
  drawGear(ctx, px + W / 2, py + H / 2 - 5,
    Math.min(W, H) * 0.22,
    (tick * (status === "active" ? 0.05 : 0.01)) % (Math.PI * 2),
    m.accentColor
  );

  // Labels
  ctx.fillStyle = "rgba(255,255,230,0.9)"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
  ctx.fillText(m.label, px + W / 2, py + H - 16);
  ctx.fillStyle = "rgba(200,200,180,0.45)"; ctx.font = "5px monospace";
  ctx.fillText(m.sublabel, px + W / 2, py + H - 7);

  // Scanline
  if (status === "active") {
    const sy = ((tick * 0.35 + m.col * 9) % H);
    ctx.globalAlpha = 0.07; ctx.fillStyle = m.lightColor; ctx.fillRect(px, py + sy, W, 3); ctx.globalAlpha = 1;
  }
}

function drawInserter(ctx: CanvasRenderingContext2D, ins: Inserter, tick: number, panX: number, panY: number) {
  if (!ins.active) return;
  const cx = ins.pivotCol * TILE + TILE / 2 - panX;
  const cy = ins.pivotRow * TILE + TILE / 2 - panY;
  const armLen = TILE * 0.65;
  const progress = (Math.sin(tick * 0.08) + 1) / 2;
  const angle = ins.srcAngle + (ins.dstAngle - ins.srcAngle) * progress;
  const tipX = cx + Math.cos(angle) * armLen;
  const tipY = cy + Math.sin(angle) * armLen;
  ctx.strokeStyle = "#667755"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.fillStyle = "#445533";
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(tipX, tipY, 4, 0, Math.PI * 2); ctx.fill();
  if (progress > 0.3 && progress < 0.9) {
    ctx.fillStyle = ins.itemColor; ctx.globalAlpha = 0.8;
    ctx.fillRect(tipX - 4, tipY - 4, 7, 7); ctx.globalAlpha = 1;
  }
}

function drawPowerPoles(ctx: CanvasRenderingContext2D, poles: PowerPole[], panX: number, panY: number, vw: number, vh: number) {
  ctx.strokeStyle = "#aa7722"; ctx.lineWidth = 1;
  // Draw wires between adjacent poles first
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i]; const b = poles[j];
      const dist = Math.sqrt((a.col - b.col) ** 2 + (a.row - b.row) ** 2);
      if (dist <= 12) {
        const ax = a.col * TILE + TILE / 2 - panX;
        const ay = a.row * TILE + TILE / 2 - panY;
        const bx = b.col * TILE + TILE / 2 - panX;
        const by = b.row * TILE + TILE / 2 - panY;
        ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  for (const pole of poles) {
    const px = pole.col * TILE + TILE / 2 - panX;
    const py = pole.row * TILE - panY;
    if (px < -20 || px > vw + 20 || py < -20 || py > vh + 20) continue;
    ctx.fillStyle = "#556644"; ctx.fillRect(px - 2, py, 4, TILE);
    ctx.fillStyle = "#334433"; ctx.fillRect(px - 7, py + 4, 14, 4);
    ctx.fillStyle = "#cc8833";
    ctx.beginPath(); ctx.arc(px - 6, py + 6, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 6, py + 6, 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawStorageChests(
  ctx: CanvasRenderingContext2D, state: FactoryState, panX: number, panY: number
) {
  const chests = [
    { col: 42, row: 19, label: "MEM", fill: Math.min(1, state.memoryCount / 200), color: "#4488ff" },
    { col: 46, row: 19, label: "QST", fill: Math.min(1, state.activeQuests / 20), color: "#ffaa00" },
    { col: 50, row: 19, label: "ORD", fill: Math.min(1, state.activeOrders / 20), color: "#ff8800" },
    { col: 54, row: 19, label: "JNL", fill: Math.min(1, state.journalCount / 100), color: "#aa44ff" },
    { col: 58, row: 19, label: "TASK",fill: Math.min(1, state.taskCount / 50),   color: "#44ff88" },
  ];
  for (const chest of chests) {
    const px = chest.col * TILE - panX;
    const py = chest.row * TILE - panY;
    const W = TILE; const H = TILE * 1.5;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px + 3, py + 3, W, H);
    const cg = ctx.createLinearGradient(px, py, px, py + H);
    cg.addColorStop(0, "#555533"); cg.addColorStop(1, "#333311");
    ctx.fillStyle = cg; ctx.fillRect(px, py, W, H);
    ctx.strokeStyle = "#777755"; ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 0.75, py + 0.75, W - 1.5, H - 1.5);
    ctx.fillStyle = "#666644"; ctx.fillRect(px, py, W, H / 3);
    ctx.fillStyle = "#888866"; ctx.fillRect(px + 2, py + 2, W - 4, 3);
    // Fill bar
    const barH = (H * 0.55) * chest.fill;
    ctx.fillStyle = `${chest.color}66`;
    ctx.fillRect(px + 3, py + H - barH - 3, W - 6, barH);
    ctx.strokeStyle = chest.color + "44"; ctx.lineWidth = 0.5;
    ctx.strokeRect(px + 3, py + H * 0.4, W - 6, H * 0.55);
    // Label
    ctx.fillStyle = "rgba(255,255,200,0.7)"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
    ctx.fillText(chest.label, px + W / 2, py + H + 10);
    ctx.fillStyle = chest.color; ctx.font = "6px monospace";
    ctx.fillText(`${Math.round(chest.fill * 100)}%`, px + W / 2, py + H - 3);
  }
}

function drawTrain(ctx: CanvasRenderingContext2D, trainX: number, panX: number, panY: number, vw: number) {
  const trackRow = 22;
  const ty = trackRow * TILE - panY;
  // Tracks
  ctx.fillStyle = "#554433"; ctx.fillRect(-panX, ty, V_COLS * TILE, TILE * 2);
  for (let c = 0; c < V_COLS; c++) {
    ctx.fillStyle = "#4a3a2a"; ctx.fillRect(c * TILE - panX, ty, 4, TILE * 2);
    ctx.fillStyle = "#6a5a44"; ctx.fillRect(c * TILE - panX + 2, ty + 3, TILE - 4, 4);
    ctx.fillRect(c * TILE - panX + 2, ty + TILE + 7, TILE - 4, 4);
  }
  // Train
  const WAGON_W = TILE * 3; const WAGON_H = TILE + 6;
  const wagons = 4;
  for (let i = 0; i < wagons; i++) {
    const wx = (trainX - i * (WAGON_W + 4)) % (V_COLS * TILE + wagons * WAGON_W) - panX;
    if (wx > vw + WAGON_W || wx < -WAGON_W) continue;
    const wy = ty + 4;
    ctx.fillStyle = i === 0 ? "#334455" : "#443322";
    ctx.fillRect(wx, wy, WAGON_W, WAGON_H);
    ctx.strokeStyle = i === 0 ? "#5588aa" : "#775544"; ctx.lineWidth = 1.5;
    ctx.strokeRect(wx + 0.75, wy + 0.75, WAGON_W - 1.5, WAGON_H - 1.5);
    if (i === 0) {
      ctx.fillStyle = "#336699"; ctx.fillRect(wx + 2, wy + 3, 12, 8);
      ctx.fillStyle = "#88bbdd"; ctx.fillRect(wx + 4, wy + 5, 8, 4);
      ctx.fillStyle = "#ff4422"; ctx.beginPath(); ctx.arc(wx + WAGON_W - 5, wy + WAGON_H / 2, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      const idx = i % 3;
      const cols = ["#4488ff", "#ffaa00", "#44ff88"];
      ctx.fillStyle = cols[idx] + "55";
      ctx.fillRect(wx + 4, wy + 4, WAGON_W - 8, WAGON_H - 8);
      ctx.fillStyle = cols[idx]; ctx.font = "6px monospace"; ctx.textAlign = "center";
      ctx.fillText(["DATA", "GOALS", "TASKS"][idx], wx + WAGON_W / 2, wy + WAGON_H / 2 + 3);
    }
    ctx.fillStyle = "#555555";
    ctx.beginPath(); ctx.arc(wx + 8, wy + WAGON_H, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(wx + WAGON_W - 8, wy + WAGON_H, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWorkers(ctx: CanvasRenderingContext2D, workers: Worker[], panX: number, panY: number) {
  for (const w of workers) {
    const wx = w.x - panX; const wy = w.y - panY;
    ctx.fillStyle = "#335533";
    ctx.fillRect(wx - 4, wy - 12, 8, 12);
    ctx.fillStyle = "#ffcc88";
    ctx.beginPath(); ctx.arc(wx, wy - 14, 4, 0, Math.PI * 2); ctx.fill();
    // Legs animation
    const legOffset = Math.sin(w.frame * 0.4) * 3;
    ctx.strokeStyle = "#2a4422"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wx - 2, wy); ctx.lineTo(wx - 2 - legOffset, wy + 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx + 2, wy); ctx.lineTo(wx + 2 + legOffset, wy + 7); ctx.stroke();
  }
}

function drawPersonaCouncilMachines(
  ctx: CanvasRenderingContext2D, state: FactoryState,
  tick: number, panX: number, panY: number
) {
  // Persona machines (green) — bottom left area
  const personaCount = Math.min(state.personas.length, 12);
  for (let i = 0; i < personaCount; i++) {
    const col = 5 + (i % 6) * 9;
    const row = 25 + Math.floor(i / 6) * 8;
    const px = col * TILE - panX; const py = row * TILE - panY;
    const W = 6 * TILE; const H = 5 * TILE;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px + 3, py + 3, W, H);
    const grd = ctx.createLinearGradient(px, py, px, py + H);
    grd.addColorStop(0, "#051505"); grd.addColorStop(1, "#020e02");
    ctx.fillStyle = grd; ctx.fillRect(px, py, W, H);
    ctx.strokeStyle = "#227733"; ctx.lineWidth = 1.5; ctx.strokeRect(px + 0.75, py + 0.75, W - 1.5, H - 1.5);
    ctx.fillStyle = "#117722"; ctx.fillRect(px, py, W, 4);
    drawGear(ctx, px + W / 2, py + H / 2 - 5, 12, (tick * 0.05 + i) % (Math.PI * 2), "#1a6633");
    const la = 0.5 + 0.5 * Math.sin(tick * 0.09 + i * 1.3);
    ctx.globalAlpha = la; ctx.fillStyle = "#44ff88"; ctx.shadowColor = "#44ff88"; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(px + W - 7, py + 10, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(100,255,150,0.85)"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
    const name = state.personas[i]?.name ?? `PERSONA·${i + 1}`;
    ctx.fillText(name.slice(0, 10).toUpperCase(), px + W / 2, py + H - 14);
    ctx.fillStyle = "rgba(50,180,80,0.5)"; ctx.font = "5px monospace";
    ctx.fillText(state.personas[i]?.role ?? "agent", px + W / 2, py + H - 6);
  }

  // Council machines (red) — bottom right area
  const councilCount = Math.min(state.councils.length, 8);
  for (let i = 0; i < councilCount; i++) {
    const col = 37 + (i % 4) * 8;
    const row = 25 + Math.floor(i / 4) * 8;
    const px = col * TILE - panX; const py = row * TILE - panY;
    const W = 5 * TILE; const H = 5 * TILE;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(px + 3, py + 3, W, H);
    const grd = ctx.createLinearGradient(px, py, px, py + H);
    grd.addColorStop(0, "#160408"); grd.addColorStop(1, "#0e0204");
    ctx.fillStyle = grd; ctx.fillRect(px, py, W, H);
    ctx.strokeStyle = "#882233"; ctx.lineWidth = 1.5; ctx.strokeRect(px + 0.75, py + 0.75, W - 1.5, H - 1.5);
    ctx.fillStyle = "#661122"; ctx.fillRect(px, py, W, 4);
    drawGear(ctx, px + W / 2, py + H / 2 - 5, 12, -(tick * 0.04 + i) % (Math.PI * 2), "#771122");
    const la = 0.5 + 0.5 * Math.sin(tick * 0.07 + i * 1.7);
    ctx.globalAlpha = la; ctx.fillStyle = "#ff4466"; ctx.shadowColor = "#ff4466"; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(px + W - 7, py + 10, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,100,120,0.85)"; ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
    ctx.fillText((state.councils[i]?.name ?? `COUNCIL·${i + 1}`).slice(0, 9).toUpperCase(), px + W / 2, py + H - 13);
    ctx.fillStyle = "rgba(180,50,60,0.5)"; ctx.font = "5px monospace";
    ctx.fillText("council", px + W / 2, py + H - 5);
  }
}

function drawZoneLabels(ctx: CanvasRenderingContext2D, panX: number, panY: number) {
  const zones = [
    { col: 0,  row: 0,  label: "⛏  INGESTION ZONE",      color: "#aa8822" },
    { col: 18, row: 2,  label: "⚙  CORE PROCESSING",      color: "#9933ee" },
    { col: 36, row: 1,  label: "📤  OUTPUT NETWORK",        color: "#22aa55" },
    { col: 42, row: 17, label: "📦  STORAGE DISTRICT",      color: "#aa6622" },
    { col: 5,  row: 24, label: "🎭  PERSONA DISTRICT",      color: "#22aa44" },
    { col: 37, row: 24, label: "🏛  COUNCIL CHAMBERS",      color: "#aa2244" },
    { col: 22, row: 22, label: "🚂  DATA TRANSIT RAIL",     color: "#6688aa" },
  ];
  for (const z of zones) {
    const tx = z.col * TILE - panX + 8;
    const ty = z.row * TILE - panY - 4;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(tx - 4, ty - 12, z.label.length * 6.2 + 8, 16);
    ctx.fillStyle = z.color;
    ctx.font = "bold 8px monospace"; ctx.textAlign = "left";
    ctx.fillText(z.label, tx, ty);
  }
}

function updateAndDrawBeltItems(ctx: CanvasRenderingContext2D, items: BeltItem[], panX: number, panY: number) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.fading) {
      item.opacity -= 0.022;
      if (item.opacity <= 0) { items.splice(i, 1); continue; }
    } else if (item.pathIdx < item.path.length) {
      const target = item.path[item.pathIdx];
      const dx = target.x - item.x; const dy = target.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < item.speed) { item.x = target.x; item.y = target.y; item.pathIdx++; }
      else { item.x += (dx / dist) * item.speed; item.y += (dy / dist) * item.speed; }
    } else { item.fading = true; }

    const S = item.size;
    const sx = item.x - panX; const sy = item.y - panY;
    ctx.globalAlpha = item.opacity;
    ctx.fillStyle = darkenColor(item.color, 35); ctx.fillRect(sx - S / 2 + 2, sy - S / 2 + 2, S, S);
    ctx.fillStyle = item.color; ctx.fillRect(sx - S / 2, sy - S / 2, S, S);
    ctx.fillStyle = lightenColor(item.color, 50); ctx.fillRect(sx - S / 2, sy - S / 2, S * 0.38, S * 0.38);
    if (item.label && S >= 9) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.font = "5px monospace"; ctx.textAlign = "center";
      ctx.fillText(item.label.slice(0, 3), sx, sy + 2);
    }
    ctx.globalAlpha = 1;
  }
}

function updateAndDrawSmoke(ctx: CanvasRenderingContext2D, smokes: Smoke[], panX: number, panY: number) {
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.x += s.vx; s.y += s.vy; s.vx *= 0.97; s.vy *= 0.97; s.life -= 0.007;
    if (s.life <= 0) { smokes.splice(i, 1); continue; }
    ctx.globalAlpha = (s.life / s.maxLife) * 0.4;
    ctx.fillStyle = s.color;
    const r = s.size * (1 + (1 - s.life / s.maxLife) * 1.5);
    ctx.beginPath(); ctx.arc(s.x - panX, s.y - panY, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function spawnSmoke(smokes: Smoke[], x: number, y: number, color: string) {
  if (smokes.length > 400) return;
  for (let i = 0; i < 2; i++) {
    smokes.push({
      x: x + (seededRand(x * 0.01 + i) - 0.5) * 8, y,
      vx: (seededRand(y * 0.01 + i) - 0.5) * 0.35,
      vy: -0.4 - seededRand(x + y + i) * 0.45,
      life: 1, maxLife: 1,
      size: 3 + seededRand(x + y + i * 3) * 5, color,
    });
  }
}

function drawMinimap(ctx: CanvasRenderingContext2D, vw: number, vh: number, panX: number, panY: number) {
  const MW = 140; const MH = 100;
  const MX = vw - MW - 8; const MY = vh - MH - 8;
  const sx = MW / (V_COLS * TILE); const sy = MH / (V_ROWS * TILE);
  ctx.fillStyle = "rgba(0,0,0,0.82)"; ctx.fillRect(MX - 2, MY - 14, MW + 4, MH + 16);
  ctx.fillStyle = "rgba(25,20,10,0.9)"; ctx.fillRect(MX, MY, MW, MH);
  // Ore patches on minimap
  for (const p of ORE_PATCHES) {
    ctx.fillStyle = ORE_COLORS[p.type] + "aa";
    ctx.fillRect(MX + p.col * TILE * sx, MY + p.row * TILE * sy, p.w * TILE * sx, p.h * TILE * sy);
  }
  // Machines
  for (const m of ASSEMBLY_MACHINES) {
    ctx.fillStyle = m.isMAVIS ? "#8b5cf6" : m.accentColor + "aa";
    ctx.fillRect(MX + m.col * TILE * sx, MY + m.row * TILE * sy, m.w * TILE * sx, m.h * TILE * sy);
  }
  // Viewport
  ctx.strokeStyle = "#ffee44"; ctx.lineWidth = 1.5;
  ctx.strokeRect(MX + panX * sx, MY + panY * sy, vw * sx, vh * sy);
  ctx.fillStyle = "rgba(180,160,60,0.55)"; ctx.font = "7px monospace"; ctx.textAlign = "left";
  ctx.fillText("SYSTEM MAP", MX, MY - 3);
}

// ─── Detail panel ───────────────────────────────────────────
function DetailPanel({ machine, onClose, navigate }: { machine: AssemblyMachine; onClose: () => void; navigate: (r: string) => void }) {
  return (
    <div className="fixed right-4 top-16 bottom-4 w-72 bg-zinc-900 border border-zinc-700 rounded-lg overflow-y-auto flex flex-col shadow-2xl z-50">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 sticky top-0 bg-zinc-900">
        <span className="font-mono text-sm font-bold truncate" style={{ color: machine.lightColor }}>{machine.label}</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-white text-lg">✕</button>
      </div>
      <div className="px-4 py-3 font-mono text-xs text-zinc-300 space-y-3">
        <div><span className="text-zinc-500">System: </span><span style={{ color: machine.lightColor }}>{machine.systemName}</span></div>
        <div><span className="text-zinc-500">Function: </span>{machine.sublabel}</div>
        <button onClick={() => navigate("/mavis")} className="w-full mt-2 py-2 rounded border font-mono text-xs transition-colors" style={{ borderColor: machine.accentColor + "80", color: machine.lightColor }}>
          Open in MAVIS →
        </button>
      </div>
    </div>
  );
}

// ─── MAVIS directive log ────────────────────────────────────
const DIRECTIVES = [
  "Consolidating 47 memory embeddings…",
  "Goal-agent cycle complete — 3 goals updated",
  "mavis-trigger-engine: 12 rules evaluated",
  "mavis-gmail-sync: 8 new emails ingested",
  "mavis-health-monitor: biometrics synced",
  "mavis-content-pipeline: 2 posts queued",
  "mavis-campaign-runner: outreach batch sent",
  "mavis-world-model: weekly update running…",
  "mavis-autonomous-engine: proactive scan done",
  "mavis-daily-scores: today's score computed",
];

// ════════════════════════════════════════════════════════════
// ─── MAIN COMPONENT ──────────────────────────────────────────
// ════════════════════════════════════════════════════════════
const INITIAL_STATE: FactoryState = {
  mavis: "active", memory: "warm", journal: "warm",
  quest: "idle", ruview: "idle", orders: "idle",
  personas: [], councils: [],
  activeQuests: 0, activeOrders: 0, memoryCount: 0, journalCount: 0, goalCount: 0, taskCount: 0,
};

export default function FactoryPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef(0);
  const tickRef   = useRef(0);

  // Mutable sim state
  const stateRef    = useRef<FactoryState>(INITIAL_STATE);
  const beltItemsRef= useRef<BeltItem[]>([]);
  const smokesRef   = useRef<Smoke[]>([]);
  const workersRef  = useRef<Worker[]>(WORKER_PATHS.map(path => ({
    x: path[0].x, y: path[0].y, path, pathIdx: 1,
    speed: 0.6 + Math.random() * 0.4, frame: 0, facingRight: true,
  })));
  const trainXRef   = useRef(0);
  const pistonRef   = useRef(0);

  // Pan state
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, dragging: false });

  // MAVIS log
  const [mavisLog, setMavisLog] = useState([DIRECTIVES[0]]);
  const logTickRef = useRef(0);

  // Click selection
  const [selectedMachine, setSelectedMachine] = useState<AssemblyMachine | null>(null);

  // React state for HUD only
  const [hudStats, setHudStats] = useState({ personas: 0, councils: 0, tasks: 0, goals: 0, memories: 0 });
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<"grab" | "grabbing">("grab");

  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Data loading ───────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [persRes, cncRes, tskRes, gRes, memRes, jRes, qRes, oRes] = await Promise.allSettled([
        supabase.from("personas").select("id, name, role"),
        supabase.from("councils").select("id, name"),
        supabase.from("tasks").select("*", { count: "exact", head: true }).neq("status", "done"),
        supabase.from("mavis_goals").select("*", { count: "exact", head: true }),
        supabase.from("mavis_notes").select("*", { count: "exact", head: true }),
        supabase.from("journal_entries").select("*", { count: "exact", head: true }),
        supabase.from("quests").select("*", { count: "exact", head: true }),
        supabase.from("standup_order_templates").select("*", { count: "exact", head: true }),
      ]);

      const personas = persRes.status === "fulfilled" ? (persRes.value.data ?? []) : [];
      const councils = cncRes.status === "fulfilled"  ? (cncRes.value.data  ?? []) : [];
      const tasks    = tskRes.status === "fulfilled"  ? (tskRes.value.count ?? 0) : 0;
      const goals    = gRes.status === "fulfilled"    ? (gRes.value.count   ?? 0) : 0;
      const mems     = memRes.status === "fulfilled"  ? (memRes.value.count ?? 0) : 0;
      const jrnl     = jRes.status === "fulfilled"    ? (jRes.value.count   ?? 0) : 0;
      const quests   = qRes.status === "fulfilled"    ? (qRes.value.count   ?? 0) : 0;
      const orders   = oRes.status === "fulfilled"    ? (oRes.value.count   ?? 0) : 0;

      const newState: FactoryState = {
        mavis:   "active",
        memory:  mems > 0    ? "active" : "warm",
        journal: jrnl > 0    ? "active" : "warm",
        quest:   goals > 0   ? "active" : "idle",
        ruview:  "warm",
        orders:  orders > 0  ? "active" : "idle",
        personas, councils,
        activeQuests: quests, activeOrders: orders,
        memoryCount: mems, journalCount: jrnl, goalCount: goals, taskCount: tasks,
      };
      stateRef.current = newState;
      setHudStats({ personas: personas.length, councils: councils.length, tasks, goals, memories: mems });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Pan & click via window-level events ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let downX = 0, downY = 0;

    function onDown(e: MouseEvent) {
      panRef.current.dragging = true;
      panRef.current.startX = e.clientX + panRef.current.x;
      panRef.current.startY = e.clientY + panRef.current.y;
      downX = e.clientX; downY = e.clientY;
      setCursor("grabbing");
      e.preventDefault();
    }
    function onMove(e: MouseEvent) {
      if (!panRef.current.dragging) return;
      const maxX = Math.max(0, V_COLS * TILE - canvas.clientWidth);
      const maxY = Math.max(0, V_ROWS * TILE - canvas.clientHeight);
      panRef.current.x = Math.max(0, Math.min(maxX, panRef.current.startX - e.clientX));
      panRef.current.y = Math.max(0, Math.min(maxY, panRef.current.startY - e.clientY));
    }
    function onUp(e: MouseEvent) {
      if (!panRef.current.dragging) return;
      panRef.current.dragging = false;
      setCursor("grab");
      const dx = e.clientX - downX, dy = e.clientY - downY;
      if (Math.sqrt(dx * dx + dy * dy) < 5) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left + panRef.current.x) / TILE;
        const my = (e.clientY - rect.top + panRef.current.y) / TILE;
        for (const m of ASSEMBLY_MACHINES) {
          if (mx >= m.col && mx < m.col + m.w && my >= m.row && my < m.row + m.h) {
            setSelectedMachine(m); return;
          }
        }
        setSelectedMachine(null);
      }
    }
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Game loop ──────────────────────────────────────────────
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const vw = canvas.width; const vh = canvas.height;
    const panX = panRef.current.x; const panY = panRef.current.y;
    const tick = tickRef.current++;
    const state = stateRef.current;

    // ── Terrain ───────────────────────────────────────────
    drawTerrain(ctx, panX, panY, vw, vh);

    // ── Ore patches ───────────────────────────────────────
    for (const patch of ORE_PATCHES) drawOrePatch(ctx, patch, panX, panY);

    // ── Belt segments ─────────────────────────────────────
    drawBeltSegments(ctx, BELT_NETWORK, tick, panX, panY, vw, vh);

    // ── Mining drills ─────────────────────────────────────
    pistonRef.current = (Math.sin(tick * 0.07) + 1) / 2;
    for (const drill of MINING_DRILLS) drawMiningDrill(ctx, drill, pistonRef.current, panX, panY);

    // ── Assembly machines ─────────────────────────────────
    for (const m of ASSEMBLY_MACHINES) {
      const status = state[m.statusKey as keyof FactoryState] as MachineStatus | any;
      const resolved: MachineStatus = (typeof status === "string" ? status : "active") as MachineStatus;
      drawAssemblyMachine(ctx, m, resolved, tick, panX, panY);
    }

    // ── Inserters ─────────────────────────────────────────
    for (const ins of INSERTERS) drawInserter(ctx, ins, tick, panX, panY);

    // ── Power poles ───────────────────────────────────────
    drawPowerPoles(ctx, POWER_POLES, panX, panY, vw, vh);

    // ── Storage chests ────────────────────────────────────
    drawStorageChests(ctx, state, panX, panY);

    // ── Train ─────────────────────────────────────────────
    trainXRef.current = (trainXRef.current + 1.2) % (V_COLS * TILE + 400);
    drawTrain(ctx, trainXRef.current, panX, panY, vw);

    // ── Persona / Council machines ────────────────────────
    drawPersonaCouncilMachines(ctx, state, tick, panX, panY);

    // ── Zone labels ───────────────────────────────────────
    drawZoneLabels(ctx, panX, panY);

    // ── Smoke from machines ───────────────────────────────
    if (tick % 8 === 0) {
      const mavis = ASSEMBLY_MACHINES[0];
      spawnSmoke(smokesRef.current, (mavis.col + mavis.w / 2) * TILE, mavis.row * TILE, "#5522aa");
      spawnSmoke(smokesRef.current, (mavis.col + mavis.w / 2 + 1) * TILE, mavis.row * TILE, "#330066");
    }
    if (tick % 18 === 0) {
      for (const drill of MINING_DRILLS) {
        const oreC = ORE_COLORS[drill.orePatch];
        spawnSmoke(smokesRef.current, (drill.col + 1) * TILE, drill.row * TILE, oreC);
      }
    }
    updateAndDrawSmoke(ctx, smokesRef.current, panX, panY);

    // ── Workers ───────────────────────────────────────────
    for (const w of workersRef.current) {
      if (w.pathIdx >= w.path.length) w.pathIdx = 0;
      const target = w.path[w.pathIdx];
      const dx = target.x - w.x; const dy = target.y - w.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < w.speed) { w.pathIdx++; }
      else { w.x += (dx / dist) * w.speed; w.y += (dy / dist) * w.speed; w.frame++; w.facingRight = dx > 0; }
    }
    drawWorkers(ctx, workersRef.current, panX, panY);

    // ── Belt items ────────────────────────────────────────
    if (tick % 35 === 0 && beltItemsRef.current.length < 60) {
      const pathKeys = Object.keys(BELT_PATHS);
      const key = pathKeys[tick % pathKeys.length];
      const path = BELT_PATHS[key];
      const itemColors: Record<string, string> = {
        memory: "#4488ff", journal: "#aa44ff", quest: "#ffaa00",
        ruview: "#00ffcc", order: "#ff8800", persona: "#44ff88",
        council: "#ff4466", output: "#ffffff",
      };
      beltItemsRef.current.push({
        x: path[0].x, y: path[0].y, path, pathIdx: 1,
        color: itemColors[key] ?? "#aaaaaa", speed: 1.6,
        opacity: 1, fading: false, label: key.slice(0, 3).toUpperCase(), size: 9,
      });
    }
    updateAndDrawBeltItems(ctx, beltItemsRef.current, panX, panY);

    // ── MAVIS directive log update ─────────────────────────
    if (tick % 180 === 0) {
      logTickRef.current = (logTickRef.current + 1) % DIRECTIVES.length;
      setMavisLog(prev => [DIRECTIVES[logTickRef.current], ...prev].slice(0, 5));
    }

    // ── Minimap ───────────────────────────────────────────
    drawMinimap(ctx, vw, vh, panX, panY);

    animRef.current = requestAnimationFrame(gameLoop);
  }, []);

  // ── Resize observer ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      // Initial pan: center on MAVIS
      const mavis = ASSEMBLY_MACHINES[0];
      panRef.current.x = Math.max(0, (mavis.col + mavis.w / 2) * TILE - canvas.clientWidth / 2);
      panRef.current.y = Math.max(0, (mavis.row + mavis.h / 2) * TILE - canvas.clientHeight / 2);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(gameLoop);
    const poll = setInterval(loadData, 30_000);
    return () => { cancelAnimationFrame(animRef.current); clearInterval(poll); };
  }, [gameLoop, loadData]);

  const totalMachines = ASSEMBLY_MACHINES.length + hudStats.personas + hudStats.councils;
  const activeCount = ASSEMBLY_MACHINES.filter(m =>
    typeof stateRef.current[m.statusKey as keyof FactoryState] === "string" &&
    stateRef.current[m.statusKey as keyof FactoryState] === "active"
  ).length;

  return (
    <div
      className="relative w-full overflow-hidden bg-[#1e1c0e]"
      style={{ height: "calc(100vh - 64px)", cursor }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: "inherit" }}
      />

      {selectedMachine && (
        <DetailPanel
          machine={selectedMachine}
          onClose={() => setSelectedMachine(null)}
          navigate={navigate}
        />
      )}

      <div className="absolute inset-0 pointer-events-none">
        {/* Top HUD */}
        <div className="absolute top-0 left-0 right-0 px-4 py-2 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
          <div>
            <span className="font-mono text-amber-400 text-sm font-bold tracking-widest">FACTORY FLOOR</span>
            <span className="font-mono text-[9px] text-amber-400/40 ml-3">
              {totalMachines} MACHINES · 276 FUNCTIONS · 203 TABLES
            </span>
          </div>
          <div className="flex gap-4 font-mono text-xs">
            {[
              { label: "TASKS",    val: hudStats.tasks,    c: "#aa44ff" },
              { label: "GOALS",    val: hudStats.goals,    c: "#44ff88" },
              { label: "MEMORIES", val: hudStats.memories, c: "#4488ff" },
              { label: "PERSONAS", val: hudStats.personas, c: "#44ff88" },
              { label: "COUNCILS", val: hudStats.councils, c: "#ff4466" },
            ].map(s => (
              <span key={s.label} className="text-[10px]" style={{ color: s.c + "bb" }}>
                {s.label} <span className="font-bold" style={{ color: s.c }}>{s.val}</span>
              </span>
            ))}
            <span className="text-green-400/70 text-[10px]">ACTIVE <span className="font-bold text-green-400">{activeCount}</span></span>
          </div>
          <button
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 font-mono text-xs transition-colors"
            onClick={loadData} disabled={loading}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "Syncing…" : "Sync"}
          </button>
        </div>

        {/* MAVIS Directive Log — bottom left */}
        <div className="absolute bottom-3 left-3 space-y-1 w-80">
          <p className="font-mono text-[8px] text-purple-400/40 tracking-widest uppercase mb-1">▸ MAVIS DIRECTIVE LOG</p>
          {mavisLog.map((msg, i) => (
            <div key={i} className={`font-mono text-[9px] px-2 py-0.5 rounded truncate ${i === 0 ? "text-purple-300 border-l-2 border-purple-500 bg-purple-950/40" : "text-zinc-600 border-l border-zinc-800"}`}>
              {msg}
            </div>
          ))}
        </div>

        {/* Item legend */}
        <div className="absolute bottom-3 right-44 flex flex-col gap-0.5">
          {[["#4488ff","Memory"],["#aa44ff","Journal"],["#ffaa00","Quest"],["#00ffcc","RuView"],["#ff8800","Orders"],["#44ff88","Persona"]].map(([c,l]) => (
            <div key={l} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
              <span className="font-mono text-[8px] text-zinc-500">{l}</span>
            </div>
          ))}
        </div>

        {/* Pan hint */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2">
          <span className="font-mono text-[8px] text-zinc-700">drag to pan · click machine for details</span>
        </div>
      </div>
    </div>
  );
}
