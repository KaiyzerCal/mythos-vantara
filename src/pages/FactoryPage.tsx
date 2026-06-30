// ============================================================
// VANTARA.EXE — FactoryPage (Authentic Factorio Visual Style)
// Dense factory floor with terrain, proper belts, inserters,
// assembly machines, power poles, trains, and ore patches.
// MAVIS AI ecosystem mapped to Factorio production network.
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

// ─── Canvas constants ─────────────────────────────────────────
const TILE = 32;
const COLS = 60;

// ─── Types ───────────────────────────────────────────────────
type MachineStatus = "active" | "warm" | "idle";

interface ClickableEntity {
  type: "drill" | "mavis" | "persona" | "council" | "storage" | "train" | "ore"
  id?: string
  name: string
  source?: string
  col: number
  row: number
  tileW: number
  tileH: number
}

interface MachineEntry {
  id: string;
  name: string;
  role: string;
  status: MachineStatus;
}

interface MachineState {
  mavis: MachineStatus;
  memory: MachineStatus;
  ruview: MachineStatus;
  orders: MachineStatus;
  journal: MachineStatus;
  quest: MachineStatus;
  personas: MachineEntry[];
  councils: MachineEntry[];
  activeQuests: number;
  activeOrders: number;
}

const INITIAL_MACHINE_STATE: MachineState = {
  mavis: "active",
  memory: "idle",
  ruview: "idle",
  orders: "idle",
  journal: "idle",
  quest: "idle",
  personas: [],
  councils: [],
  activeQuests: 0,
  activeOrders: 0,
};

// ─── Item colors for belt items ───────────────────────────────
const ITEM_COLORS: Record<string, string> = {
  memory: "#4488ff",
  journal: "#aa44ff",
  quest: "#ffaa00",
  ruview: "#00ffcc",
  order: "#ff8800",
  persona: "#44ff88",
  council: "#ff4466",
  processed: "#ffffff",
  iron: "#8899aa",
  copper: "#cc7744",
  coal: "#334455",
  stone: "#998877",
};

// ─── Seeded pseudo-random for terrain variation ───────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

// ─── Terrain tile color (dark brown/olive with variation) ─────
function terrainColor(col: number, row: number): string {
  const n1 = seededRand(col * 137 + row * 251);
  const n2 = seededRand(col * 79 + row * 317 + 1000);
  const n3 = seededRand(col * 199 + row * 53 + 2000);
  const r = Math.floor(33 + n1 * 14 + n2 * 5);
  const g = Math.floor(30 + n1 * 10 + n3 * 6);
  const b = Math.floor(16 + n2 * 10);
  return `rgb(${r},${g},${b})`;
}

// ─── Belt segment types ───────────────────────────────────────
type BeltType =
  | "h-right"
  | "h-left"
  | "v-down"
  | "v-up"
  | "corner-ne"
  | "corner-nw"
  | "corner-se"
  | "corner-sw";

interface BeltSegment {
  col: number;
  row: number;
  type: BeltType;
  speed: "yellow" | "red" | "blue";
}

// ─── Power poles ──────────────────────────────────────────────
interface PowerPole {
  col: number;
  row: number;
}

// ─── Train ───────────────────────────────────────────────────
interface Train {
  x: number;
  direction: 1 | -1;
  speed: number;
  wagons: number;
  trackRow: number;
}

// ─── Belt item on canvas ──────────────────────────────────────
interface BeltItem {
  x: number;
  y: number;
  path: { x: number; y: number }[];
  pathIdx: number;
  color: string;
  speed: number;
  opacity: number;
  fading: boolean;
  label: string;
  size: number;
}

// ─── Smoke particle ───────────────────────────────────────────
interface Smoke {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

// ─── Worker ──────────────────────────────────────────────────
interface Worker {
  x: number;
  y: number;
  path: { x: number; y: number }[];
  pathIdx: number;
  speed: number;
  frame: number;
  facingRight: boolean;
}

// ─── Inserter ────────────────────────────────────────────────
interface InserterDef {
  pivotCol: number;
  pivotRow: number;
  sourceAngle: number;
  destAngle: number;
  itemColor: string;
  statusKey: keyof MachineState;
}

// ─── Assembly machine definition ─────────────────────────────
interface AssemblyMachine {
  col: number;
  row: number;
  w: number;
  h: number;
  label: string;
  bodyColor: string;
  accentColor: string;
  lightColor: string;
  statusKey: keyof MachineState;
  isMAVIS?: boolean;
}

// ─── Mining drill ─────────────────────────────────────────────
interface MiningDrill {
  col: number;
  row: number;
  orePatch: OreType;
}

type OreType = "iron" | "copper" | "coal" | "stone" | "memory" | "quest";

const ORE_COLORS: Record<OreType, string> = {
  iron: "#6688aa",
  copper: "#cc7744",
  coal: "#222233",
  stone: "#888877",
  memory: "#1a3a6b",
  quest: "#5c3a00",
};

const ORE_ROCK_COLORS: Record<OreType, string> = {
  iron: "#8899bb",
  copper: "#dd8855",
  coal: "#334455",
  stone: "#aaa999",
  memory: "#2255aa",
  quest: "#885500",
};

// ─── Ore patches ──────────────────────────────────────────────
interface OrePatch {
  col: number;
  row: number;
  w: number;
  h: number;
  type: OreType;
  label: string;
}

const ORE_PATCHES: OrePatch[] = [
  { col: 0, row: 1, w: 4, h: 3, type: "iron", label: "Memory/Journal" },
  { col: 6, row: 0, w: 4, h: 3, type: "copper", label: "Quests/Goals" },
  { col: 12, row: 1, w: 3, h: 3, type: "coal", label: "Standing Orders" },
  { col: 17, row: 0, w: 3, h: 3, type: "stone", label: "RuView Data" },
  { col: 0, row: 6, w: 3, h: 2, type: "memory", label: "Deep Memory" },
  { col: 6, row: 6, w: 3, h: 2, type: "quest", label: "Active Quests" },
];

// ─── Mining drill positions ───────────────────────────────────
const MINING_DRILLS: MiningDrill[] = [
  { col: 0, row: 1, orePatch: "iron" },
  { col: 2, row: 1, orePatch: "iron" },
  { col: 6, row: 0, orePatch: "copper" },
  { col: 8, row: 0, orePatch: "copper" },
  { col: 12, row: 1, orePatch: "coal" },
  { col: 17, row: 0, orePatch: "stone" },
];

// ─── Belt network builder ─────────────────────────────────────
function buildBeltNetwork(): BeltSegment[] {
  const belts: BeltSegment[] = [];

  // Feeder belts (vertical, rows 4-5)
  const feeders = [1, 3, 7, 9, 13, 18];
  feeders.forEach((col) => {
    for (let row = 4; row <= 5; row++) {
      belts.push({ col, row, type: "v-down", speed: "yellow" });
    }
    belts.push({ col, row: 6, type: "corner-se", speed: "yellow" });
  });

  // Main horizontal spine at row 6 (going east toward MAVIS, col 2-23)
  for (let col = 2; col <= 23; col++) {
    if (!feeders.includes(col)) {
      belts.push({ col, row: 6, type: "h-right", speed: "red" });
    }
  }
  belts.push({ col: 24, row: 6, type: "h-right", speed: "red" });

  // Main belt continues east of MAVIS (col 31-52)
  for (let col = 31; col <= 52; col++) {
    belts.push({ col, row: 6, type: "h-right", speed: "blue" });
  }

  // Return belt going west at row 8
  for (let col = 5; col <= 22; col++) {
    belts.push({ col, row: 8, type: "h-left", speed: "yellow" });
  }
  belts.push({ col: 4, row: 8, type: "corner-sw", speed: "yellow" });

  // Persona side belt (col 3, rows 7-27, going south)
  for (let row = 7; row <= 27; row++) {
    belts.push({ col: 3, row, type: "v-down", speed: "yellow" });
  }

  // Council side belt connector (row 8, col 32-47 going east, then corner south at col 48)
  for (let col = 32; col <= 47; col++) {
    belts.push({ col, row: 8, type: "h-right", speed: "yellow" });
  }
  belts.push({ col: 48, row: 8, type: "corner-se", speed: "yellow" });
  for (let row = 9; row <= 27; row++) {
    belts.push({ col: 48, row, type: "v-down", speed: "yellow" });
  }

  // Output belt from MAVIS going east (row 12)
  for (let col = 27; col <= 55; col++) {
    belts.push({ col, row: 12, type: "h-right", speed: "blue" });
  }

  // Storage feeder belts going south from output belt
  for (const col of [46, 50, 54]) {
    for (let row = 13; row <= 15; row++) {
      belts.push({ col, row, type: "v-down", speed: "yellow" });
    }
  }

  // Second horizontal belt at row 15 (east side)
  for (let col = 27; col <= 44; col++) {
    belts.push({ col, row: 15, type: "h-right", speed: "yellow" });
  }

  return belts;
}

const BELT_NETWORK = buildBeltNetwork();

// ─── Power poles ──────────────────────────────────────────────
const POWER_POLES: PowerPole[] = [];
for (let col = 0; col <= 55; col += 10) {
  for (let row = 0; row <= 40; row += 10) {
    POWER_POLES.push({ col, row });
  }
}

// ─── Assembly machines ────────────────────────────────────────
const ASSEMBLY_MACHINES: AssemblyMachine[] = [
  {
    col: 24, row: 3, w: 5, h: 5,
    label: "MAVIS PRIME",
    bodyColor: "#130d2a",
    accentColor: "#6b21d8",
    lightColor: "#a855f7",
    statusKey: "mavis",
    isMAVIS: true,
  },
  {
    col: 20, row: 3, w: 3, h: 3,
    label: "MEM PROC",
    bodyColor: "#0d1a2a",
    accentColor: "#2255aa",
    lightColor: "#4488ff",
    statusKey: "memory",
  },
  {
    col: 20, row: 7, w: 3, h: 3,
    label: "JOURNAL",
    bodyColor: "#100820",
    accentColor: "#5522aa",
    lightColor: "#aa44ff",
    statusKey: "journal",
  },
  {
    col: 29, row: 3, w: 3, h: 3,
    label: "QUEST HUB",
    bodyColor: "#1a1000",
    accentColor: "#885500",
    lightColor: "#ffaa00",
    statusKey: "quest",
  },
  {
    col: 29, row: 7, w: 3, h: 3,
    label: "RUVIEW",
    bodyColor: "#001a1a",
    accentColor: "#007766",
    lightColor: "#00ffcc",
    statusKey: "ruview",
  },
  {
    col: 33, row: 3, w: 3, h: 3,
    label: "ORDERS",
    bodyColor: "#1a0a00",
    accentColor: "#884400",
    lightColor: "#ff8800",
    statusKey: "orders",
  },
  {
    col: 36, row: 3, w: 3, h: 3,
    label: "PERSONA CORE",
    bodyColor: "#001a08",
    accentColor: "#117733",
    lightColor: "#44ff88",
    statusKey: "mavis",
  },
  {
    col: 36, row: 7, w: 3, h: 3,
    label: "COUNCIL CORE",
    bodyColor: "#1a0008",
    accentColor: "#882233",
    lightColor: "#ff4466",
    statusKey: "mavis",
  },
];

// ─── Inserter definitions ─────────────────────────────────────
const INSERTER_DEFS: InserterDef[] = [
  { pivotCol: 23, pivotRow: 5, sourceAngle: Math.PI, destAngle: 0, itemColor: "#4488ff", statusKey: "memory" },
  { pivotCol: 23, pivotRow: 6, sourceAngle: Math.PI, destAngle: 0, itemColor: "#aa44ff", statusKey: "journal" },
  { pivotCol: 29, pivotRow: 5, sourceAngle: 0, destAngle: Math.PI, itemColor: "#ffaa00", statusKey: "quest" },
  { pivotCol: 29, pivotRow: 6, sourceAngle: 0, destAngle: Math.PI, itemColor: "#00ffcc", statusKey: "ruview" },
  { pivotCol: 26, pivotRow: 9, sourceAngle: -Math.PI / 2, destAngle: Math.PI / 2, itemColor: "#ffffff", statusKey: "mavis" },
  { pivotCol: 1, pivotRow: 3, sourceAngle: Math.PI / 2, destAngle: -Math.PI / 2, itemColor: "#8899aa", statusKey: "memory" },
  { pivotCol: 7, pivotRow: 3, sourceAngle: Math.PI / 2, destAngle: -Math.PI / 2, itemColor: "#cc7744", statusKey: "quest" },
  { pivotCol: 13, pivotRow: 3, sourceAngle: Math.PI / 2, destAngle: -Math.PI / 2, itemColor: "#333344", statusKey: "orders" },
];

// ─── Worker patrol paths ──────────────────────────────────────
const WORKER_PATROL_PATHS = [
  [
    { x: 5 * TILE, y: 9 * TILE },
    { x: 5 * TILE, y: 20 * TILE },
    { x: 20 * TILE, y: 20 * TILE },
    { x: 20 * TILE, y: 9 * TILE },
  ],
  [
    { x: 30 * TILE, y: 10 * TILE },
    { x: 45 * TILE, y: 10 * TILE },
    { x: 45 * TILE, y: 20 * TILE },
    { x: 30 * TILE, y: 20 * TILE },
  ],
  [
    { x: 15 * TILE, y: 25 * TILE },
    { x: 35 * TILE, y: 25 * TILE },
    { x: 35 * TILE, y: 35 * TILE },
    { x: 15 * TILE, y: 35 * TILE },
  ],
  [
    { x: 50 * TILE, y: 15 * TILE },
    { x: 55 * TILE, y: 15 * TILE },
    { x: 55 * TILE, y: 25 * TILE },
    { x: 50 * TILE, y: 25 * TILE },
  ],
];

// ─── Belt item paths ──────────────────────────────────────────
const BELT_ITEM_PATHS: Record<string, { x: number; y: number }[]> = {
  memory: [
    { x: 1 * TILE + TILE / 2, y: 2 * TILE },
    { x: 1 * TILE + TILE / 2, y: 6 * TILE + TILE / 2 },
    { x: 24 * TILE, y: 6 * TILE + TILE / 2 },
    { x: 24 * TILE, y: 5 * TILE + TILE / 2 },
  ],
  journal: [
    { x: 3 * TILE + TILE / 2, y: 2 * TILE },
    { x: 3 * TILE + TILE / 2, y: 6 * TILE + TILE / 2 },
    { x: 24 * TILE, y: 6 * TILE + TILE / 2 },
    { x: 24 * TILE, y: 7 * TILE + TILE / 2 },
  ],
  quest: [
    { x: 7 * TILE + TILE / 2, y: 2 * TILE },
    { x: 7 * TILE + TILE / 2, y: 6 * TILE + TILE / 2 },
    { x: 24 * TILE, y: 6 * TILE + TILE / 2 },
    { x: 26 * TILE, y: 6 * TILE + TILE / 2 },
    { x: 26 * TILE, y: 5 * TILE },
  ],
  ruview: [
    { x: 18 * TILE + TILE / 2, y: 2 * TILE },
    { x: 18 * TILE + TILE / 2, y: 6 * TILE + TILE / 2 },
    { x: 26 * TILE, y: 6 * TILE + TILE / 2 },
    { x: 26 * TILE, y: 7 * TILE },
  ],
  order: [
    { x: 13 * TILE + TILE / 2, y: 2 * TILE },
    { x: 13 * TILE + TILE / 2, y: 6 * TILE + TILE / 2 },
    { x: 26 * TILE, y: 6 * TILE + TILE / 2 },
  ],
  persona: [
    { x: 3 * TILE + TILE / 2, y: 9 * TILE },
    { x: 3 * TILE + TILE / 2, y: 20 * TILE },
    { x: 24 * TILE, y: 20 * TILE },
    { x: 24 * TILE, y: 8 * TILE },
  ],
  processed: [
    { x: 29 * TILE, y: 8 * TILE + TILE / 2 },
    { x: 52 * TILE, y: 8 * TILE + TILE / 2 },
    { x: 52 * TILE, y: 12 * TILE + TILE / 2 },
    { x: 55 * TILE, y: 12 * TILE + TILE / 2 },
  ],
};

// ─── Color helpers ─────────────────────────────────────────────
function lightenColor(hex: string, amount: number): string {
  if (hex.startsWith("rgb")) return hex;
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex: string, amount: number): string {
  if (hex.startsWith("rgb")) return hex;
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): string {
  if (hex.startsWith("rgb")) return "168,85,247";
  const num = parseInt(hex.replace("#", ""), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `${r},${g},${b}`;
}

// ─── Drawing functions ────────────────────────────────────────

function drawTerrain(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const numCols = Math.ceil(W / TILE) + 1;
  const numRows = Math.ceil(H / TILE) + 1;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      ctx.fillStyle = terrainColor(c, r);
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      // Subtle grain dots
      const n = seededRand(c * 311 + r * 127 + 5555);
      if (n > 0.85) {
        const gn = seededRand(c * 211 + r * 97 + 9999);
        ctx.fillStyle = `rgba(${Math.floor(40 + gn * 20)},${Math.floor(50 + gn * 20)},${Math.floor(20 + gn * 10)},0.4)`;
        ctx.fillRect(c * TILE + Math.floor(n * TILE), r * TILE + Math.floor(gn * TILE), 2, 2);
      }
    }
  }
}

function drawOrePatch(ctx: CanvasRenderingContext2D, patch: OrePatch) {
  const x = patch.col * TILE;
  const y = patch.row * TILE;
  const w = patch.w * TILE;
  const h = patch.h * TILE;

  ctx.fillStyle = ORE_COLORS[patch.type];
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;

  const rocks = patch.w * patch.h * 8;
  for (let i = 0; i < rocks; i++) {
    const rx = seededRand(i * 137 + patch.col * 31);
    const ry = seededRand(i * 241 + patch.row * 53);
    const rr = 2 + seededRand(i * 97 + 7) * 4;
    ctx.fillStyle = ORE_ROCK_COLORS[patch.type];
    ctx.globalAlpha = 0.7 + seededRand(i * 53) * 0.3;
    ctx.beginPath();
    ctx.ellipse(x + rx * w, y + ry * h, rr, rr * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.ellipse(x + rx * w - rr * 0.2, y + ry * h - rr * 0.2, rr * 0.4, rr * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(patch.label.toUpperCase(), x + w / 2, y - 3);
}

function drawBeltSegment(
  ctx: CanvasRenderingContext2D,
  seg: BeltSegment,
  beltOffset: number
) {
  const x = seg.col * TILE;
  const y = seg.row * TILE;
  const T = TILE;

  const bodyColor = seg.speed === "blue" ? "#1a3a8a" : seg.speed === "red" ? "#6a1a1a" : "#6a5a1a";
  const stripeColor = seg.speed === "blue" ? "#3366cc" : seg.speed === "red" ? "#cc3333" : "#c8a800";
  const edgeColor = seg.speed === "blue" ? "#335599" : seg.speed === "red" ? "#993333" : "#998800";

  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, y, T, T);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, T, T);
  ctx.clip();

  const isH = seg.type === "h-right" || seg.type === "h-left";
  const isV = seg.type === "v-down" || seg.type === "v-up";

  if (isH) {
    const dir = seg.type === "h-right" ? 1 : -1;
    ctx.fillStyle = edgeColor;
    ctx.fillRect(x, y, T, 3);
    ctx.fillRect(x, y + T - 3, T, 3);
    ctx.fillRect(x, y + T / 2 - 1, T, 2);

    for (let lane = 0; lane < 2; lane++) {
      const laneY = y + (lane === 0 ? T / 4 : 3 * T / 4);
      for (let i = -1; i <= 2; i++) {
        const offset = ((beltOffset * dir + i * 18) % 18 + 18) % 18;
        const cx2 = x + offset + (dir < 0 ? T - offset * 2 : 0);
        ctx.strokeStyle = stripeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx2 + dir * 4, laneY - 3);
        ctx.lineTo(cx2 + dir * 8, laneY);
        ctx.lineTo(cx2 + dir * 4, laneY + 3);
        ctx.stroke();
      }
    }
  } else if (isV) {
    const dir = seg.type === "v-down" ? 1 : -1;
    ctx.fillStyle = edgeColor;
    ctx.fillRect(x, y, 3, T);
    ctx.fillRect(x + T - 3, y, 3, T);
    ctx.fillRect(x + T / 2 - 1, y, 2, T);

    for (let lane = 0; lane < 2; lane++) {
      const laneX = x + (lane === 0 ? T / 4 : 3 * T / 4);
      for (let i = -1; i <= 2; i++) {
        const offset = ((beltOffset * dir + i * 18) % 18 + 18) % 18;
        const cy2 = y + offset;
        ctx.strokeStyle = stripeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(laneX - 3, cy2 + dir * 4);
        ctx.lineTo(laneX, cy2 + dir * 8);
        ctx.lineTo(laneX + 3, cy2 + dir * 4);
        ctx.stroke();
      }
    }
  } else {
    // Corner pieces
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x, y, T, T);

    const drawArc = (ox: number, oy: number, r1: number, r2: number, startA: number, endA: number) => {
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ox, oy, r1, startA, endA);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox, oy, r2, startA, endA);
      ctx.stroke();
      ctx.strokeStyle = stripeColor + "88";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ox, oy, (r1 + r2) / 2, startA, endA);
      ctx.stroke();
    };

    const r1 = T * 0.3;
    const r2 = T * 0.7;
    if (seg.type === "corner-se") drawArc(x, y, r1, r2, 0, Math.PI / 2);
    else if (seg.type === "corner-sw") drawArc(x + T, y, r1, r2, Math.PI / 2, Math.PI);
    else if (seg.type === "corner-ne") drawArc(x, y + T, r1, r2, -Math.PI / 2, 0);
    else if (seg.type === "corner-nw") drawArc(x + T, y + T, r1, r2, Math.PI, 3 * Math.PI / 2);

    ctx.fillStyle = edgeColor;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, T, T);
}

function drawGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  teeth: number,
  rotation: number,
  color: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a1 = (i / teeth) * Math.PI * 2 - 0.15;
    const a2 = (i / teeth) * Math.PI * 2 + 0.15;
    const a3 = ((i + 0.5) / teeth) * Math.PI * 2 - 0.1;
    const a4 = ((i + 0.5) / teeth) * Math.PI * 2 + 0.1;
    ctx.moveTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    ctx.lineTo(Math.cos(a3) * (radius + 4), Math.sin(a3) * (radius + 4));
    ctx.lineTo(Math.cos(a4) * (radius + 4), Math.sin(a4) * (radius + 4));
    ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
  }
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius * 0.42, Math.sin(a) * radius * 0.42);
    ctx.lineTo(Math.cos(a) * radius * 0.78, Math.sin(a) * radius * 0.78);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMiningDrill(
  ctx: CanvasRenderingContext2D,
  drill: MiningDrill,
  frame: number,
  status: MachineStatus
) {
  const x = drill.col * TILE;
  const y = drill.row * TILE;
  const W = 2 * TILE;
  const H = 2 * TILE;
  const alpha = status === "active" ? 1 : status === "warm" ? 0.7 : 0.45;
  ctx.globalAlpha = alpha;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(x + 3, y + 3, W, H);

  const bodyGrad = ctx.createLinearGradient(x, y, x + W, y + H);
  bodyGrad.addColorStop(0, "#b89a28");
  bodyGrad.addColorStop(0.5, "#d4b030");
  bodyGrad.addColorStop(1, "#9a7e1a");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(x + 2, y + 2, W - 4, H - 4);

  ctx.fillStyle = "#2a2410";
  ctx.fillRect(x + 8, y + 8, W - 16, H / 2 - 4);

  ctx.fillStyle = "#887722";
  [[x + 5, y + 5], [x + W - 7, y + 5], [x + 5, y + H - 7], [x + W - 7, y + H - 7]].forEach(([bx, by]) => {
    ctx.beginPath();
    ctx.arc(bx, by, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#aa9933";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  const pistonOffset = status !== "idle" ? Math.sin(frame * 0.15) * 4 : 0;
  ctx.fillStyle = "#555533";
  ctx.fillRect(x + W / 2 - 4, y + H / 2 + 2 + pistonOffset, 8, H / 2 - 4 - pistonOffset);

  ctx.fillStyle = status === "active" ? "#666644" : "#333322";
  ctx.beginPath();
  ctx.moveTo(x + W / 2 - 8, y + H - 4);
  ctx.lineTo(x + W / 2 + 8, y + H - 4);
  ctx.lineTo(x + W / 2, y + H + 6);
  ctx.closePath();
  ctx.fill();

  const gSpeed = status === "active" ? frame * 0.08 : status === "warm" ? frame * 0.025 : 0;
  drawGear(ctx, x + W / 2, y + H / 4, 8, 6, gSpeed, "#aa9933");

  const ledColor = status === "active" ? "#44ff44" : status === "warm" ? "#ffcc00" : "#882222";
  ctx.fillStyle = ledColor;
  ctx.shadowColor = ledColor;
  ctx.shadowBlur = status === "active" ? 6 : 2;
  ctx.beginPath();
  ctx.arc(x + W - 8, y + 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawAssemblyMachine(
  ctx: CanvasRenderingContext2D,
  machine: AssemblyMachine,
  status: MachineStatus,
  frame: number,
  gearRot: number,
  labelOverride?: string
) {
  const x = machine.col * TILE;
  const y = machine.row * TILE;
  const W = machine.w * TILE;
  const H = machine.h * TILE;
  const cx = x + W / 2;
  const cy = y + H / 2;
  const alpha = status === "active" ? 1 : status === "warm" ? 0.75 : 0.5;

  ctx.globalAlpha = alpha;

  if (machine.isMAVIS) {
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.7);
    glowGrad.addColorStop(0, "rgba(100,50,200,0.35)");
    glowGrad.addColorStop(0.5, "rgba(80,20,160,0.15)");
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.fillRect(x - W * 0.3, y - H * 0.3, W * 1.6, H * 1.6);
    ctx.globalAlpha = alpha;
  }

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x + 4, y + 4, W, H);

  const bodyGrad = ctx.createLinearGradient(x, y, x, y + H);
  bodyGrad.addColorStop(0, lightenColor(machine.bodyColor, 20));
  bodyGrad.addColorStop(0.5, machine.bodyColor);
  bodyGrad.addColorStop(1, darkenColor(machine.bodyColor, 20));
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(x + 2, y + 2, W - 4, H - 4);

  ctx.strokeStyle = machine.accentColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 2, y + 2, W - 4, H - 4);

  const panelPad = machine.isMAVIS ? 8 : 5;
  ctx.fillStyle = darkenColor(machine.bodyColor, 30);
  ctx.fillRect(x + panelPad, y + panelPad, W - panelPad * 2, H - panelPad * 2);

  const boltSize = machine.isMAVIS ? 4 : 3;
  const boltPad = machine.isMAVIS ? 7 : 5;
  ctx.fillStyle = machine.accentColor;
  [[x + boltPad, y + boltPad], [x + W - boltPad, y + boltPad], [x + boltPad, y + H - boltPad], [x + W - boltPad, y + H - boltPad]].forEach(([bx, by]) => {
    ctx.beginPath();
    ctx.arc(bx, by, boltSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lightenColor(machine.accentColor, 30);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.strokeStyle = lightenColor(machine.accentColor, 20);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx - boltSize * 0.6, by);
    ctx.lineTo(bx + boltSize * 0.6, by);
    ctx.moveTo(bx, by - boltSize * 0.6);
    ctx.lineTo(bx, by + boltSize * 0.6);
    ctx.stroke();
  });

  const gRadius = machine.isMAVIS ? 22 : Math.min(W, H) / 4;
  const gSpeed = status === "active" ? 0.04 : status === "warm" ? 0.012 : 0;
  drawGear(ctx, cx, cy, gRadius, machine.isMAVIS ? 10 : 6, gearRot * gSpeed, machine.accentColor);

  if (machine.isMAVIS) {
    drawGear(ctx, cx, cy, 11, 7, -gearRot * gSpeed * 1.8, machine.lightColor);
    if (status === "active") {
      const pr = 28 + Math.sin(frame * 0.07) * 5;
      ctx.strokeStyle = `rgba(${hexToRgb(machine.lightColor)},${0.3 + Math.sin(frame * 0.07) * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = machine.lightColor;
    ctx.lineWidth = 1.5;
    const cs = 12;
    [[x + 4, y + 4, 1, 1], [x + W - 4, y + 4, -1, 1], [x + 4, y + H - 4, 1, -1], [x + W - 4, y + H - 4, -1, -1]].forEach(([px, py, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(px, py + sy * cs);
      ctx.lineTo(px, py);
      ctx.lineTo(px + sx * cs, py);
      ctx.stroke();
    });
  }

  if (machine.w >= 3) {
    const pipeColor = "#445555";
    const pipeH = machine.isMAVIS ? 14 : 10;
    ctx.fillStyle = pipeColor;
    ctx.fillRect(x - 4, cy - pipeH / 2, 6, pipeH);
    ctx.strokeStyle = "#667788";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 4, cy - pipeH / 2, 6, pipeH);
    ctx.fillStyle = pipeColor;
    ctx.fillRect(x + W - 2, cy - pipeH / 2, 6, pipeH);
    ctx.strokeRect(x + W - 2, cy - pipeH / 2, 6, pipeH);
  }

  const lightR = machine.isMAVIS ? 5 : 3;
  const lightX = x + W - (machine.isMAVIS ? 12 : 8);
  const lightY = y + (machine.isMAVIS ? 12 : 8);
  const ledColor = status === "active" ? machine.lightColor : status === "warm" ? "#ffcc00" : "#552222";
  ctx.fillStyle = ledColor;
  ctx.shadowColor = ledColor;
  ctx.shadowBlur = status === "active" ? (machine.isMAVIS ? 12 : 8) : 2;
  ctx.beginPath();
  ctx.arc(lightX, lightY, lightR, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (status === "active" && machine.w >= 3) {
    ctx.fillStyle = "#445566";
    ctx.fillRect(cx - 3, y - 6, 6, 8);
  }

  const displayLabel = labelOverride ?? machine.label;
  ctx.fillStyle = machine.accentColor;
  ctx.font = `bold ${machine.isMAVIS ? 10 : 8}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(displayLabel, cx, y + H + 12);

  ctx.globalAlpha = 1;
}

function drawDynamicMachine(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  name: string,
  status: MachineStatus,
  frame: number,
  gearRot: number,
  isPersona: boolean
) {
  drawAssemblyMachine(
    ctx,
    {
      col, row, w: 3, h: 3,
      label: name,
      bodyColor: isPersona ? "#061a12" : "#1a0608",
      accentColor: isPersona ? "#117733" : "#882233",
      lightColor: isPersona ? "#44ff88" : "#ff4466",
      statusKey: "mavis",
    },
    status,
    frame,
    gearRot,
    name.slice(0, 10)
  );
}

function drawInserter(
  ctx: CanvasRenderingContext2D,
  ins: InserterDef,
  frame: number,
  status: MachineStatus
) {
  const pivotX = ins.pivotCol * TILE + TILE / 2;
  const pivotY = ins.pivotRow * TILE + TILE / 2;
  const armLen = TILE * 1.0;
  const isActive = status !== "idle";

  const t = (Math.sin(frame * (isActive ? 0.06 : 0.02)) + 1) / 2;
  const currentAngle = ins.sourceAngle + (ins.destAngle - ins.sourceAngle) * t;
  const tipX = pivotX + Math.cos(currentAngle) * armLen;
  const tipY = pivotY + Math.sin(currentAngle) * armLen;

  const baseColor = isActive ? "#c87822" : "#664422";
  const armColor = isActive ? "#d4883a" : "#774433";

  ctx.fillStyle = darkenColor(baseColor, 10);
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = lightenColor(baseColor, 30);
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = armColor;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.lineCap = "butt";

  const clawSize = 4;
  ctx.fillStyle = isActive ? ins.itemColor : "#555544";
  ctx.strokeStyle = isActive ? lightenColor(ins.itemColor, 20) : "#666655";
  ctx.lineWidth = 1;
  ctx.fillRect(tipX - clawSize, tipY - clawSize, clawSize * 2, clawSize * 2);
  ctx.strokeRect(tipX - clawSize, tipY - clawSize, clawSize * 2, clawSize * 2);
}

function drawPowerPole(ctx: CanvasRenderingContext2D, pole: PowerPole) {
  const x = pole.col * TILE + TILE / 2;
  const y = pole.row * TILE + TILE / 2;

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x - 1, y - 2, 6, TILE + 4);

  ctx.fillStyle = "#6b4a20";
  ctx.fillRect(x - 2, y - TILE / 2, 4, TILE + TILE / 4);

  ctx.fillStyle = "#7a5525";
  ctx.fillRect(x - 10, y - TILE / 2, 20, 3);

  ctx.fillStyle = "#888";
  [-8, 8].forEach((dx) => {
    ctx.beginPath();
    ctx.arc(x + dx, y - TILE / 2, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPowerWires(ctx: CanvasRenderingContext2D, poles: PowerPole[]) {
  for (let i = 0; i < poles.length; i++) {
    for (let j = i + 1; j < poles.length; j++) {
      const a = poles[i];
      const b = poles[j];
      const dx = Math.abs(a.col - b.col);
      const dy = Math.abs(a.row - b.row);
      if ((dx === 10 && dy === 0) || (dx === 0 && dy === 10)) {
        const ax = a.col * TILE + TILE / 2 - 8;
        const ay = a.row * TILE + TILE / 2 - TILE / 2;
        const bx = b.col * TILE + TILE / 2 - 8;
        const by2 = b.row * TILE + TILE / 2 - TILE / 2;
        const midX = (ax + bx) / 2;
        const midY = (ay + by2) / 2 + (dx === 10 ? 12 : 0);

        ctx.strokeStyle = "#cc8800";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(midX, midY, bx, by2);
        ctx.stroke();

        const ax2 = a.col * TILE + TILE / 2 + 8;
        const bx2 = b.col * TILE + TILE / 2 + 8;
        const mid2X = (ax2 + bx2) / 2;
        ctx.beginPath();
        ctx.moveTo(ax2, ay);
        ctx.quadraticCurveTo(mid2X, midY, bx2, by2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}

function drawRailTrack(ctx: CanvasRenderingContext2D, row: number, W: number) {
  const y = row * TILE;

  ctx.fillStyle = "#3a3530";
  ctx.fillRect(0, y - 2, W, TILE + 4);

  for (let x = 0; x < W; x += 16) {
    ctx.fillStyle = "#4a3a28";
    ctx.fillRect(x, y + 2, 12, TILE - 4);
    ctx.fillStyle = "#3a2a18";
    ctx.fillRect(x, y + 3, 12, 2);
  }

  ctx.strokeStyle = "#888880";
  ctx.lineWidth = 3;
  [6, TILE - 8].forEach((ro) => {
    ctx.beginPath();
    ctx.moveTo(0, y + ro);
    ctx.lineTo(W, y + ro);
    ctx.stroke();
    ctx.strokeStyle = "#aaaaa8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + ro - 1);
    ctx.lineTo(W, y + ro - 1);
    ctx.stroke();
    ctx.strokeStyle = "#888880";
    ctx.lineWidth = 3;
  });
}

function drawTrain(ctx: CanvasRenderingContext2D, train: Train, frame: number) {
  const y = train.trackRow * TILE;
  const dir = train.direction;
  const locoW = TILE * 2;
  const locoH = TILE - 6;
  const locoX = dir > 0 ? train.x : train.x - locoW;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(locoX + 3, y + 4, locoW, locoH);

  const locoGrad = ctx.createLinearGradient(locoX, y, locoX, y + locoH);
  locoGrad.addColorStop(0, "#3a3a3a");
  locoGrad.addColorStop(0.4, "#555555");
  locoGrad.addColorStop(1, "#222222");
  ctx.fillStyle = locoGrad;
  ctx.fillRect(locoX, y + 3, locoW, locoH);

  ctx.fillStyle = "#cc2222";
  const frontX = dir > 0 ? locoX + locoW - 4 : locoX;
  ctx.fillRect(frontX, y + 3, 4, locoH);

  ctx.fillStyle = "#222";
  const chimneyX = dir > 0 ? locoX + 4 : locoX + locoW - 8;
  ctx.fillRect(chimneyX, y, 6, 6);

  const wheelPositions = [locoX + 4, locoX + locoW / 2 - 2, locoX + locoW - 10];
  wheelPositions.forEach((wx) => {
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(wx + 4, y + locoH + 1, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  for (let i = 0; i < train.wagons; i++) {
    const wagonW = TILE * 2;
    const gapW = 4;
    const wagonX = dir > 0
      ? locoX - (i + 1) * (wagonW + gapW)
      : locoX + locoW + (i + 1) * (wagonW + gapW) - wagonW;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(wagonX + 3, y + 4, wagonW, locoH);

    const wGrad = ctx.createLinearGradient(wagonX, y, wagonX, y + locoH);
    wGrad.addColorStop(0, "#444444");
    wGrad.addColorStop(1, "#222222");
    ctx.fillStyle = wGrad;
    ctx.fillRect(wagonX + 2, y + 3, wagonW - 4, locoH);

    const stripeColors = ["#c87800", "#4488cc", "#44aa44"];
    ctx.fillStyle = stripeColors[i % stripeColors.length];
    ctx.fillRect(wagonX + 2, y + 5, wagonW - 4, 4);

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.strokeRect(wagonX + 2, y + 3, wagonW - 4, locoH);

    [wagonX + 6, wagonX + wagonW - 10].forEach((wx) => {
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(wx, y + locoH + 1, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  if (frame % 20 < 10) {
    ctx.fillStyle = `rgba(150,150,140,${0.25 + Math.sin(frame * 0.2) * 0.1})`;
    ctx.beginPath();
    ctx.arc(chimneyX + 3, y - 4 - (frame % 20) * 0.4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWorker(ctx: CanvasRenderingContext2D, worker: Worker) {
  const x = worker.x;
  const y = worker.y;
  const legSwing = Math.sin(worker.frame * 0.3) * 3;

  ctx.save();
  if (!worker.facingRight) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2244aa";
  ctx.fillRect(x - 3, y + 4, 3, 5 + legSwing);
  ctx.fillRect(x + 1, y + 4, 3, 5 - legSwing);

  const bodyGrad = ctx.createLinearGradient(x - 4, y - 2, x + 4, y + 5);
  bodyGrad.addColorStop(0, "#3355cc");
  bodyGrad.addColorStop(1, "#1a3388");
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(x - 4, y - 2, 8, 7);

  ctx.fillStyle = "#2244aa";
  ctx.fillRect(x - 6, y - 1 + legSwing * 0.5, 3, 5);
  ctx.fillRect(x + 4, y - 1 - legSwing * 0.5, 3, 5);

  ctx.fillStyle = "#ffcc88";
  ctx.beginPath();
  ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff8800";
  ctx.beginPath();
  ctx.arc(x, y - 5, 4, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 5, y - 5, 10, 2);

  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(x + 2, y - 4, 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawStorageChests(ctx: CanvasRenderingContext2D, machineStates: MachineState) {
  const chestPositions = [
    { col: 46, row: 16 },
    { col: 50, row: 16 },
    { col: 54, row: 16 },
    { col: 48, row: 19 },
    { col: 52, row: 19 },
  ];
  const fillLevel = Math.min(1, (machineStates.activeOrders + machineStates.activeQuests) / 20);
  const labels = ["MEM", "QST", "ORD", "PCR", "KNW"];

  chestPositions.forEach((pos, i) => {
    const x = pos.col * TILE;
    const y = pos.row * TILE;
    const W = TILE;
    const H = TILE;

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x + 3, y + 3, W, H);

    const chestGrad = ctx.createLinearGradient(x, y, x, y + H);
    chestGrad.addColorStop(0, "#555533");
    chestGrad.addColorStop(0.5, "#444422");
    chestGrad.addColorStop(1, "#333311");
    ctx.fillStyle = chestGrad;
    ctx.fillRect(x + 2, y + 2, W - 4, H - 4);

    ctx.strokeStyle = "#777755";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, y + 2, W - 4, H - 4);

    ctx.fillStyle = "#666644";
    ctx.fillRect(x + 2, y + 2, W - 4, H / 3);
    ctx.fillStyle = "#888866";
    ctx.fillRect(x + 3, y + 3, W - 6, 3);

    ctx.fillStyle = "#888";
    ctx.beginPath();
    ctx.arc(x + W / 2, y + H / 3 + 1, 3, 0, Math.PI * 2);
    ctx.fill();

    const barH = (H * 0.5) * fillLevel;
    ctx.fillStyle = `rgba(200,160,0,${0.3 + fillLevel * 0.4})`;
    ctx.fillRect(x + 4, y + H / 2 + (H * 0.5 - barH), W - 8, barH);

    ctx.fillStyle = "rgba(255,255,200,0.7)";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText(labels[i % 5], x + W / 2, y + H + 10);
  });
}

function updateAndDrawBeltItems(ctx: CanvasRenderingContext2D, items: BeltItem[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (item.fading) {
      item.opacity -= 0.02;
      if (item.opacity <= 0) {
        items.splice(i, 1);
        continue;
      }
    } else if (item.pathIdx < item.path.length) {
      const target = item.path[item.pathIdx];
      const dx = target.x - item.x;
      const dy = target.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < item.speed) {
        item.x = target.x;
        item.y = target.y;
        item.pathIdx++;
      } else {
        item.x += (dx / dist) * item.speed;
        item.y += (dy / dist) * item.speed;
      }
    } else {
      item.fading = true;
    }

    const S = item.size;
    ctx.globalAlpha = item.opacity;

    // 3D-ish cube look: side shadow face
    ctx.fillStyle = darkenColor(item.color, 30);
    ctx.fillRect(item.x - S / 2 + 2, item.y - S / 2 + 2, S, S);

    // Top face
    ctx.fillStyle = item.color;
    ctx.fillRect(item.x - S / 2, item.y - S / 2, S, S);

    // Highlight
    ctx.fillStyle = lightenColor(item.color, 40);
    ctx.fillRect(item.x - S / 2, item.y - S / 2, S * 0.35, S * 0.35);

    ctx.globalAlpha = 1;
  }
}

function updateAndDrawSmoke(ctx: CanvasRenderingContext2D, smokes: Smoke[]) {
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.98;
    s.vy *= 0.98;
    s.life -= 0.008;
    if (s.life <= 0) {
      smokes.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = (s.life / s.maxLife) * 0.45;
    ctx.fillStyle = s.color;
    const r = s.size * (1 + (1 - s.life / s.maxLife) * 1.5);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function spawnSmoke(smokes: Smoke[], x: number, y: number, color: string = "#667788") {
  for (let i = 0; i < 2; i++) {
    smokes.push({
      x: x + (Math.random() - 0.5) * 8,
      y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.5 - Math.random() * 0.5,
      life: 1,
      maxLife: 1,
      size: 4 + Math.random() * 5,
      color,
    });
  }
}

// ─── Relative timestamp helper ────────────────────────────────
function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── EntityDetailPanel ────────────────────────────────────────
function EntityDetailPanel({
  entity,
  details,
  loading,
  onClose,
  onNavigate,
}: {
  entity: ClickableEntity;
  details: any;
  loading: boolean;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const icon = {
    drill: "⛏️",
    mavis: "🧠",
    persona: "🎭",
    council: "🏛️",
    storage: "📦",
    train: "🚂",
    ore: "💎",
  }[entity.type] ?? "📌";

  return (
    <div className="fixed right-4 top-16 bottom-4 w-80 max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg overflow-y-auto flex flex-col shadow-2xl z-50 transition-all">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 sticky top-0 bg-zinc-900">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm font-bold text-amber-400 truncate">{entity.name}</div>
          <div className="font-mono text-[10px] text-zinc-500 uppercase">{entity.type}{entity.source ? ` · ${entity.source}` : ""}</div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-3 font-mono text-xs text-zinc-300 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-500">
            <span className="animate-spin mr-2">⟳</span> Loading…
          </div>
        )}

        {!loading && details && (() => {
          const src = details.source;

          if ((src === "memory" || src === "journal" || src === "quest") && details.records) {
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">DATA SOURCE · {src.toUpperCase()}</div>
                {details.records.length === 0 && <div className="text-zinc-600">No records found.</div>}
                {details.records.map((r: any, i: number) => (
                  <div key={i} className="border border-zinc-800 rounded p-2 space-y-1">
                    {r.title && <div className="text-amber-300 truncate">{r.title}</div>}
                    {r.summary && <div className="text-zinc-400 text-[11px] line-clamp-2">{r.summary}</div>}
                    {r.content && !r.summary && <div className="text-zinc-400 text-[11px] line-clamp-2">{r.content}</div>}
                    {r.mood && <span className="text-violet-400">mood: {r.mood}</span>}
                    {r.status && <span className="text-green-400 ml-2">{r.status}</span>}
                    <div className="text-zinc-600 text-[10px]">{relativeTime(r.created_at ?? r.updated_at)}</div>
                  </div>
                ))}
              </>
            );
          }

          if (src === "orders" && details.templates !== undefined) {
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">STANDING ORDERS</div>
                {[...(details.templates ?? []), ...(details.orders ?? [])].map((r: any, i: number) => (
                  <div key={i} className="border border-zinc-800 rounded p-2">
                    <div className="text-amber-300 truncate">{r.title ?? r.order_text ?? "Order"}</div>
                    <div className="text-zinc-600 text-[10px]">{relativeTime(r.last_triggered_at ?? r.created_at)}</div>
                  </div>
                ))}
                {(details.templates?.length ?? 0) + (details.orders?.length ?? 0) === 0 && (
                  <div className="text-zinc-600">No active orders.</div>
                )}
              </>
            );
          }

          if (src === "ruview" && details.record !== undefined) {
            const r = details.record;
            if (!r) return <div className="text-zinc-600">No RuView data.</div>;
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">BIOMETRIC FEED</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "PRESENT", val: r.present ? "YES" : "NO", color: r.present ? "text-green-400" : "text-red-400" },
                    { label: "HEART RATE", val: r.heart_rate_bpm ? `${r.heart_rate_bpm} bpm` : "—", color: "text-rose-400" },
                    { label: "BREATHING", val: r.breathing_rate ? `${r.breathing_rate}/min` : "—", color: "text-cyan-400" },
                    { label: "STRESS", val: r.stress_level ?? "—", color: "text-orange-400" },
                  ].map((m) => (
                    <div key={m.label} className="border border-zinc-800 rounded p-2">
                      <div className="text-zinc-500 text-[9px]">{m.label}</div>
                      <div className={`font-bold ${m.color}`}>{m.val}</div>
                    </div>
                  ))}
                </div>
                <div className="text-zinc-600 text-[10px]">Updated {relativeTime(r.updated_at)}</div>
              </>
            );
          }

          if (src === "mavis") {
            const filledConfig = (details.config ?? []).filter((c: any) => c.content && !c.content.includes("[TO BE FILLED]"));
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">MAVIS BRAIN</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">MEMORIES</div>
                    <div className="text-blue-400 font-bold">{details.memoriesCount}</div>
                  </div>
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">QUESTS</div>
                    <div className="text-amber-400 font-bold">{details.questsCount}</div>
                  </div>
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">ORDERS</div>
                    <div className="text-orange-400 font-bold">{details.ordersCount}</div>
                  </div>
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">CONFIG</div>
                    <div className="text-green-400 font-bold">{filledConfig.length}/{(details.config ?? []).length}</div>
                  </div>
                </div>
                {details.lastConsolidation && (
                  <div className="text-zinc-500 text-[10px]">Brain last consolidated: {relativeTime(details.lastConsolidation)}</div>
                )}
                {(details.notionSync ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-2">LAST NOTION SYNC</div>
                    {details.notionSync.map((n: any, i: number) => (
                      <div key={i} className="text-zinc-400 text-[11px] truncate">{n.page_title} <span className="text-zinc-600">{relativeTime(n.synced_at)}</span></div>
                    ))}
                  </>
                )}
              </>
            );
          }

          if (src === "persona") {
            const p = details.persona;
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">PERSONA</div>
                {p && (
                  <div className="flex items-center gap-3 border border-zinc-800 rounded p-3">
                    <div className="w-8 h-8 rounded-full bg-green-900 flex items-center justify-center text-green-300 font-bold text-sm">
                      {p.name?.[0] ?? "?"}
                    </div>
                    <div>
                      <div className="text-amber-300 font-bold">{p.name}</div>
                      <div className="text-zinc-500 text-[10px]">{p.role ?? ""}</div>
                    </div>
                  </div>
                )}
                {(details.memories ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">RECENT MEMORIES</div>
                    {details.memories.map((m: any, i: number) => (
                      <div key={i} className="border border-zinc-800 rounded p-2">
                        <div className="text-zinc-400 text-[11px] line-clamp-2">{m.summary ?? m.content}</div>
                        <div className="text-zinc-600 text-[10px]">{relativeTime(m.created_at)}</div>
                      </div>
                    ))}
                  </>
                )}
              </>
            );
          }

          if (src === "council") {
            const c = details.council;
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">COUNCIL</div>
                {c && (
                  <div className="border border-zinc-800 rounded p-3">
                    <div className="text-amber-300 font-bold">{c.name}</div>
                    <div className="text-zinc-500 text-[10px]">{c.specialty ?? c.role ?? ""}</div>
                    {c.domain && <div className="text-violet-400 text-[10px] mt-1">Domain: {c.domain}</div>}
                  </div>
                )}
                {(details.memories ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">RECENT MEMORIES</div>
                    {details.memories.map((m: any, i: number) => (
                      <div key={i} className="border border-zinc-800 rounded p-2">
                        <div className="text-zinc-400 text-[11px] line-clamp-2">{m.summary ?? m.content}</div>
                        <div className="text-zinc-600 text-[10px]">{relativeTime(m.created_at)}</div>
                      </div>
                    ))}
                  </>
                )}
              </>
            );
          }

          if (src === "storage") {
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">VAULT STATUS</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">MEMORIES</div>
                    <div className="text-blue-400 font-bold">{details.memoriesCount}</div>
                  </div>
                  <div className="border border-zinc-800 rounded p-2">
                    <div className="text-zinc-500 text-[9px]">NOTION PAGES</div>
                    <div className="text-violet-400 font-bold">{details.notionCount}</div>
                  </div>
                </div>
                {(details.topTags ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">TOP TAGS</div>
                    <div className="flex flex-wrap gap-1">
                      {details.topTags.map((tag: string) => (
                        <span key={tag} className="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400 text-[10px]">{tag}</span>
                      ))}
                    </div>
                  </>
                )}
              </>
            );
          }

          if (src === "train") {
            return (
              <>
                <div className="text-zinc-500 text-[10px] uppercase tracking-wider">BATCH JOBS</div>
                {(details.consolidations ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">BRAIN CONSOLIDATIONS</div>
                    {details.consolidations.map((c: any, i: number) => (
                      <div key={i} className="border border-zinc-800 rounded p-2">
                        <div className="text-zinc-400 text-[11px] line-clamp-2">{c.summary ?? "Consolidation run"}</div>
                        <div className="text-zinc-600 text-[10px]">{relativeTime(c.created_at)}</div>
                      </div>
                    ))}
                  </>
                )}
                {(details.notionPages ?? []).length > 0 && (
                  <>
                    <div className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">NOTION SYNCED</div>
                    {details.notionPages.map((n: any, i: number) => (
                      <div key={i} className="text-zinc-400 text-[11px] truncate">{n.page_title} <span className="text-zinc-600">{relativeTime(n.synced_at)}</span></div>
                    ))}
                  </>
                )}
              </>
            );
          }

          return null;
        })()}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-700">
        <button
          onClick={onNavigate}
          className="w-full py-2 bg-violet-900/50 hover:bg-violet-800/60 border border-violet-700/50 rounded font-mono text-xs text-violet-300 transition-colors"
        >
          Open in MAVIS →
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────
export default function FactoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beltOffsetRef = useRef(0);
  const gearRotRef = useRef(0);
  const frameRef = useRef(0);
  const beltItemsRef = useRef<BeltItem[]>([]);
  const smokesRef = useRef<Smoke[]>([]);
  const workersRef = useRef<Worker[]>([]);
  const trainsRef = useRef<Train[]>([]);
  const machineStatesRef = useRef<MachineState>(INITIAL_MACHINE_STATE);
  const entityMapRef = useRef<Map<string, ClickableEntity>>(new Map());
  const selectedEntityRef = useRef<ClickableEntity | null>(null);

  const [machineStates, setMachineStates] = useState<MachineState>(INITIAL_MACHINE_STATE);
  const [loading, setLoading] = useState(false);
  const [itemsPerMin, setItemsPerMin] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<ClickableEntity | null>(null);
  const [entityDetails, setEntityDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const allStatuses: MachineStatus[] = [
    machineStates.mavis,
    machineStates.memory,
    machineStates.ruview,
    machineStates.orders,
    machineStates.journal,
    machineStates.quest,
    ...machineStates.personas.map((p) => p.status),
    ...machineStates.councils.map((c) => c.status),
  ];
  const activeCount = allStatuses.filter((s) => s === "active").length;
  const warmCount = allStatuses.filter((s) => s === "warm").length;
  const idleCount = allStatuses.filter((s) => s === "idle").length;

  const spawnBeltItem = useCallback((type: keyof typeof BELT_ITEM_PATHS) => {
    const path = BELT_ITEM_PATHS[type];
    if (!path || path.length < 2) return;
    beltItemsRef.current.push({
      x: path[0].x,
      y: path[0].y,
      path,
      pathIdx: 1,
      color: ITEM_COLORS[type] ?? "#888",
      speed: 1.5 + Math.random() * 0.6,
      opacity: 1,
      fading: false,
      label: type,
      size: 7,
    });
  }, []);

  const loadFactoryState = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const now = new Date();

      const [personasRes, councilsRes, memoriesRes, ordersRes, ruviewRes, questsRes] =
        await Promise.all([
          (supabase as any)
            .from("personas")
            .select("id,name,role,updated_at")
            .eq("user_id", user.id)
            .limit(6),
          (supabase as any)
            .from("councils")
            .select("id,name,role,specialty,updated_at")
            .eq("user_id", user.id)
            .limit(6),
          (supabase as any)
            .from("mavis_agent_memories")
            .select("created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1),
          (supabase as any)
            .from("standing_order_templates")
            .select("id")
            .eq("user_id", user.id)
            .in("status", ["active", "pinned"]),
          (supabase as any)
            .from("mavis_ruview_state")
            .select("updated_at,present,heart_rate_bpm")
            .eq("user_id", user.id)
            .maybeSingle(),
          (supabase as any)
            .from("quests")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .limit(10),
        ]);

      const getStatus = (dateStr?: string | null): MachineStatus => {
        if (!dateStr) return "idle";
        const d = new Date(dateStr).getTime();
        const diff = now.getTime() - d;
        if (diff < 3_600_000) return "active";
        if (diff < 86_400_000) return "warm";
        return "idle";
      };

      const nextState: MachineState = {
        mavis: "active",
        memory: getStatus(memoriesRes.data?.[0]?.created_at),
        ruview: ruviewRes.data ? getStatus(ruviewRes.data.updated_at) : "idle",
        orders: (ordersRes.data?.length ?? 0) > 0 ? "active" : "idle",
        journal: "warm",
        quest: (questsRes.data?.length ?? 0) > 0 ? "active" : "idle",
        personas: (personasRes.data ?? []).map(
          (p: { id: string; name: string; role: string; updated_at?: string }) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            status: getStatus(p.updated_at),
          })
        ),
        councils: (councilsRes.data ?? []).map(
          (c: { id: string; name: string; role?: string; specialty?: string; updated_at?: string }) => ({
            id: c.id,
            name: c.name,
            role: c.specialty ?? c.role ?? "",
            status: getStatus(c.updated_at),
          })
        ),
        activeQuests: questsRes.data?.length ?? 0,
        activeOrders: ordersRes.data?.length ?? 0,
      };

      machineStatesRef.current = nextState;
      setMachineStates(nextState);

      const activeSources = [
        nextState.memory,
        nextState.ruview,
        nextState.orders,
        nextState.quest,
        nextState.journal,
      ].filter((s) => s === "active").length;
      setItemsPerMin(activeSources * 5);

      if (nextState.memory === "active") spawnBeltItem("memory");
      if (nextState.ruview === "active") spawnBeltItem("ruview");
      if (nextState.orders === "active") spawnBeltItem("order");
      if (nextState.quest === "active") spawnBeltItem("quest");
      if (nextState.journal !== "idle") spawnBeltItem("journal");
      if ((personasRes.data?.length ?? 0) > 0) spawnBeltItem("persona");
      if (nextState.mavis === "active") spawnBeltItem("processed");
    } catch (err) {
      console.error("[FactoryPage] DB error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, spawnBeltItem]);

  // Sync selectedEntity state → ref (for gameLoop access without re-renders)
  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  // Fetch entity details on selection change
  useEffect(() => {
    if (!selectedEntity || !user?.id) return;
    const userId = user.id;

    const fetchDetails = async () => {
      setDetailsLoading(true);
      try {
        let details: any = {};

        if (selectedEntity.type === "drill" || selectedEntity.type === "ore") {
          const src = selectedEntity.source;
          if (src === "memory") {
            const { data } = await (supabase as any)
              .from("mavis_agent_memories")
              .select("content,summary,importance,tags,created_at")
              .eq("user_id", userId)
              .eq("status", "active")
              .order("created_at", { ascending: false })
              .limit(5);
            details = { records: data ?? [], source: "memory" };
          } else if (src === "journal") {
            const { data } = await (supabase as any)
              .from("journal_entries")
              .select("title,content,mood,created_at")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(5);
            details = { records: data ?? [], source: "journal" };
          } else if (src === "quest") {
            const { data } = await (supabase as any)
              .from("quests")
              .select("title,description,status,progress,updated_at")
              .eq("user_id", userId)
              .eq("status", "active")
              .limit(8);
            details = { records: data ?? [], source: "quest" };
          } else if (src === "ruview") {
            const { data } = await (supabase as any)
              .from("mavis_ruview_state")
              .select("*")
              .eq("user_id", userId)
              .maybeSingle();
            details = { record: data, source: "ruview" };
          } else if (src === "orders") {
            const [{ data: templates }, { data: orders }] = await Promise.all([
              (supabase as any)
                .from("standing_order_templates")
                .select("title,description,status,trigger_type,last_triggered_at")
                .eq("user_id", userId)
                .in("status", ["active", "pinned"])
                .limit(8),
              (supabase as any)
                .from("mavis_standing_orders")
                .select("order_text,enabled,created_at")
                .eq("user_id", userId)
                .eq("enabled", true)
                .limit(5),
            ]);
            details = { templates: templates ?? [], orders: orders ?? [], source: "orders" };
          }
        } else if (selectedEntity.type === "mavis") {
          const [memoriesCount, config, ordersCount, notionSync, questsCount] = await Promise.all([
            (supabase as any)
              .from("mavis_agent_memories")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("status", "active"),
            (supabase as any)
              .from("mavis_agent_config")
              .select("section,content,updated_at")
              .eq("user_id", userId)
              .order("sort_order"),
            (supabase as any)
              .from("mavis_standing_orders")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("enabled", true),
            (supabase as any)
              .from("mavis_notion_sync_log")
              .select("page_title,synced_at")
              .eq("user_id", userId)
              .order("synced_at", { ascending: false })
              .limit(3),
            (supabase as any)
              .from("quests")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("status", "active"),
          ]);
          const { data: lastConsolidation } = await (supabase as any)
            .from("mavis_agent_memories")
            .select("created_at")
            .eq("user_id", userId)
            .contains("tags", ["daily-consolidation"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          details = {
            source: "mavis",
            memoriesCount: memoriesCount.count ?? 0,
            config: config.data ?? [],
            ordersCount: ordersCount.count ?? 0,
            notionSync: notionSync.data ?? [],
            questsCount: questsCount.count ?? 0,
            lastConsolidation: lastConsolidation?.created_at ?? null,
          };
        } else if (selectedEntity.type === "persona" && selectedEntity.id) {
          const [personaRes, memoriesRes] = await Promise.all([
            (supabase as any)
              .from("personas")
              .select("*")
              .eq("id", selectedEntity.id)
              .maybeSingle(),
            (supabase as any)
              .from("mavis_agent_memories")
              .select("content,summary,tags,created_at")
              .eq("user_id", userId)
              .like("agent_id", "persona/%")
              .order("created_at", { ascending: false })
              .limit(5),
          ]);
          details = { source: "persona", persona: personaRes.data, memories: memoriesRes.data ?? [] };
        } else if (selectedEntity.type === "council" && selectedEntity.id) {
          const [councilRes, memoriesRes] = await Promise.all([
            (supabase as any)
              .from("councils")
              .select("*")
              .eq("id", selectedEntity.id)
              .maybeSingle(),
            (supabase as any)
              .from("mavis_agent_memories")
              .select("content,summary,created_at")
              .eq("user_id", userId)
              .like("agent_id", "council/%")
              .order("created_at", { ascending: false })
              .limit(5),
          ]);
          details = { source: "council", council: councilRes.data, memories: memoriesRes.data ?? [] };
        } else if (selectedEntity.type === "storage") {
          const [countRes, tagsRes, notionRes] = await Promise.all([
            (supabase as any)
              .from("mavis_agent_memories")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("status", "active"),
            (supabase as any)
              .from("mavis_agent_memories")
              .select("tags")
              .eq("user_id", userId)
              .limit(20),
            (supabase as any)
              .from("mavis_notion_sync_log")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId),
          ]);
          const tagCounts: Record<string, number> = {};
          (tagsRes.data ?? []).forEach((r: any) => {
            (r.tags ?? []).forEach((t: string) => { tagCounts[t] = (tagCounts[t] ?? 0) + 1; });
          });
          const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag);
          details = {
            source: "storage",
            memoriesCount: countRes.count ?? 0,
            notionCount: notionRes.count ?? 0,
            topTags,
          };
        } else if (selectedEntity.type === "train") {
          const [notionRes, consolidationRes] = await Promise.all([
            (supabase as any)
              .from("mavis_notion_sync_log")
              .select("page_title,page_url,synced_at")
              .eq("user_id", userId)
              .order("synced_at", { ascending: false })
              .limit(5),
            (supabase as any)
              .from("mavis_agent_memories")
              .select("summary,tags,created_at")
              .eq("user_id", userId)
              .contains("tags", ["daily-consolidation"])
              .order("created_at", { ascending: false })
              .limit(3),
          ]);
          details = {
            source: "train",
            notionPages: notionRes.data ?? [],
            consolidations: consolidationRes.data ?? [],
          };
        }

        setEntityDetails(details);
      } catch (err) {
        console.error("[FactoryPage] detail fetch error:", err);
        setEntityDetails(null);
      } finally {
        setDetailsLoading(false);
      }
    };

    fetchDetails();
  }, [selectedEntity, user?.id]);

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Initialize workers
  useEffect(() => {
    workersRef.current = WORKER_PATROL_PATHS.map((path, i) => ({
      x: path[0].x,
      y: path[0].y,
      path,
      pathIdx: 1,
      speed: 0.8 + i * 0.1,
      frame: i * 10,
      facingRight: true,
    }));
  }, []);

  // Initialize trains
  useEffect(() => {
    trainsRef.current = [
      { x: 0, direction: 1, speed: 0.8, wagons: 3, trackRow: 34 },
      { x: COLS * TILE, direction: -1, speed: 0.6, wagons: 2, trackRow: 37 },
      { x: 10 * TILE, direction: 1, speed: 1.0, wagons: 2, trackRow: 40 },
    ];
  }, []);

  // Spawn initial belt items
  useEffect(() => {
    spawnBeltItem("memory");
    spawnBeltItem("journal");
    spawnBeltItem("quest");
    spawnBeltItem("processed");
  }, [spawnBeltItem]);

  // Canvas click handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const col = Math.floor(canvasX / TILE);
    const row = Math.floor(canvasY / TILE);
    const key = `${col},${row}`;
    const entity = entityMapRef.current.get(key);
    if (entity) {
      if (selectedEntityRef.current && selectedEntityRef.current.col === entity.col && selectedEntityRef.current.row === entity.row && selectedEntityRef.current.type === entity.type) return;
      setSelectedEntity(entity);
    } else {
      setSelectedEntity(null);
      setEntityDetails(null);
    }
  }, []);

  // Canvas mousemove handler for cursor changes
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
    const col = Math.floor(canvasX / TILE);
    const row = Math.floor(canvasY / TILE);
    const key = `${col},${row}`;
    const entity = entityMapRef.current.get(key);
    canvas.style.cursor = entity ? "pointer" : "default";
  }, []);

  // Game loop
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const states = machineStatesRef.current;
    const frame = frameRef.current;

    const patchStatusKeys: (keyof MachineState)[] = [
      "memory", "memory", "quest", "quest", "orders", "ruview",
    ];

    // Clear entity map each frame
    entityMapRef.current.clear();

    // 1. Terrain
    drawTerrain(ctx, W, H);

    // 2. Rail tracks (below everything else)
    drawRailTrack(ctx, 34, W);
    drawRailTrack(ctx, 37, W);
    drawRailTrack(ctx, 40, W);

    // 3. Power wires (above terrain, under entities)
    drawPowerWires(ctx, POWER_POLES);

    // 4. Ore patches
    // Register ore patches
    ORE_PATCHES.forEach((p) => {
      for (let dc = 0; dc < p.w; dc++) {
        for (let dr = 0; dr < p.h; dr++) {
          entityMapRef.current.set(`${p.col + dc},${p.row + dr}`, {
            type: "ore",
            name: p.label,
            source: p.type === "iron" ? "memory" : p.type === "copper" ? "quest" : p.type === "coal" ? "orders" : p.type === "stone" ? "ruview" : p.type === "memory" ? "memory" : "quest",
            col: p.col,
            row: p.row,
            tileW: p.w,
            tileH: p.h,
          });
        }
      }
      drawOrePatch(ctx, p);
    });

    // 5. Belt network
    BELT_NETWORK.forEach((seg) => drawBeltSegment(ctx, seg, beltOffsetRef.current));

    // 6. Power poles
    POWER_POLES.forEach((p) => drawPowerPole(ctx, p));

    // 7. Mining drills
    // Register mining drills
    MINING_DRILLS.forEach((drill, i) => {
      const sk = patchStatusKeys[i] ?? "memory";
      const src = sk as string;
      for (let dc = 0; dc < 2; dc++) {
        for (let dr = 0; dr < 2; dr++) {
          entityMapRef.current.set(`${drill.col + dc},${drill.row + dr}`, {
            type: "drill",
            name: `DRILL (${src.toUpperCase()})`,
            source: src,
            col: drill.col,
            row: drill.row,
            tileW: 2,
            tileH: 2,
          });
        }
      }
      const statusKey = patchStatusKeys[i] ?? "memory";
      const status = (states[statusKey] as MachineStatus) ?? "idle";
      drawMiningDrill(ctx, drill, frame, status);
    });

    // 8. Inserter arms
    INSERTER_DEFS.forEach((ins) => {
      const status = (states[ins.statusKey] as MachineStatus) ?? "idle";
      drawInserter(ctx, ins, frame, status);
    });

    // 9. Static assembly machines
    // Register MAVIS hub and assembly machines
    ASSEMBLY_MACHINES.forEach((machine) => {
      const entityType: ClickableEntity["type"] = machine.isMAVIS ? "mavis" : "drill";
      const srcMap: Record<string, ClickableEntity["source"]> = {
        memory: "memory", journal: "journal", quest: "quest",
        ruview: "ruview", orders: "orders",
      };
      for (let dc = 0; dc < machine.w; dc++) {
        for (let dr = 0; dr < machine.h; dr++) {
          entityMapRef.current.set(`${machine.col + dc},${machine.row + dr}`, {
            type: entityType,
            name: machine.label,
            source: machine.isMAVIS ? undefined : (srcMap[machine.statusKey as string] ?? machine.statusKey as string),
            col: machine.col,
            row: machine.row,
            tileW: machine.w,
            tileH: machine.h,
          });
        }
      }
      const status = (states[machine.statusKey] as MachineStatus) ?? "idle";
      drawAssemblyMachine(ctx, machine, status, frame, gearRotRef.current);
    });

    // 10. Persona machines (left side, dynamic)
    const personaList = states.personas.length > 0
      ? states.personas
      : [{ id: "0", name: "IDLE", role: "", status: "idle" as MachineStatus }];
    // Register persona machines
    personaList.slice(0, 6).forEach((p, i) => {
      const pCol = 5;
      const pRow = 10 + i * 4;
      for (let dc = 0; dc < 3; dc++) {
        for (let dr = 0; dr < 3; dr++) {
          entityMapRef.current.set(`${pCol + dc},${pRow + dr}`, {
            type: "persona",
            id: p.id,
            name: p.name,
            col: pCol,
            row: pRow,
            tileW: 3,
            tileH: 3,
          });
        }
      }
      drawDynamicMachine(ctx, pCol, pRow, p.name, p.status, frame, gearRotRef.current, true);
    });

    // 11. Council machines (right side, dynamic)
    const councilList = states.councils.length > 0
      ? states.councils
      : [{ id: "0", name: "IDLE", role: "", status: "idle" as MachineStatus }];
    // Register council machines
    councilList.slice(0, 6).forEach((c, i) => {
      const cCol = 49;
      const cRow = 10 + i * 4;
      for (let dc = 0; dc < 3; dc++) {
        for (let dr = 0; dr < 3; dr++) {
          entityMapRef.current.set(`${cCol + dc},${cRow + dr}`, {
            type: "council",
            id: c.id,
            name: c.name,
            col: cCol,
            row: cRow,
            tileW: 3,
            tileH: 3,
          });
        }
      }
      drawDynamicMachine(ctx, cCol, cRow, c.name, c.status, frame, gearRotRef.current, false);
    });

    // 12. Storage chests
    // Register storage chests
    const chestPositions2 = [
      { col: 46, row: 16 },
      { col: 50, row: 16 },
      { col: 54, row: 16 },
      { col: 48, row: 19 },
      { col: 52, row: 19 },
    ];
    chestPositions2.forEach((pos, i) => {
      entityMapRef.current.set(`${pos.col},${pos.row}`, {
        type: "storage",
        name: ["MEM VAULT", "QUEST STORE", "ORDER CACHE", "PERSONA CORE", "KNOWLEDGE"][i] ?? "STORAGE",
        col: pos.col,
        row: pos.row,
        tileW: 1,
        tileH: 1,
      });
    });
    drawStorageChests(ctx, states);

    // 13. Smoke/steam particles
    if (frame % 18 === 0) {
      ASSEMBLY_MACHINES.forEach((m) => {
        const status = (states[m.statusKey] as MachineStatus) ?? "idle";
        if (status === "active" && m.w >= 3) {
          spawnSmoke(smokesRef.current, m.col * TILE + (m.w * TILE) / 2, m.row * TILE - 4, m.isMAVIS ? "#8866aa" : "#667788");
        }
      });
      MINING_DRILLS.forEach((drill, i) => {
        const sk = patchStatusKeys[i] ?? "memory";
        const status = (states[sk] as MachineStatus) ?? "idle";
        if (status === "active") {
          spawnSmoke(smokesRef.current, drill.col * TILE + TILE, drill.row * TILE, "#887766");
        }
      });
    }
    updateAndDrawSmoke(ctx, smokesRef.current);

    // 14. Belt items
    if (frame % 90 === 0) {
      if (states.memory !== "idle") spawnBeltItem("memory");
      if (states.quest !== "idle") spawnBeltItem("quest");
      if (states.journal !== "idle") spawnBeltItem("journal");
    }
    if (frame % 60 === 0 && states.mavis === "active") spawnBeltItem("processed");
    updateAndDrawBeltItems(ctx, beltItemsRef.current);

    // 15. Trains
    // Register trains near station
    trainsRef.current.forEach((train) => {
      const tCol = Math.floor(train.x / TILE);
      const tRow = train.trackRow;
      if (tCol >= 0 && tCol < COLS) {
        entityMapRef.current.set(`${tCol},${tRow}`, {
          type: "train",
          name: "BATCH RUNNER",
          col: tCol,
          row: tRow,
          tileW: 2,
          tileH: 1,
        });
      }
      train.x += train.speed * train.direction;
      const maxX = W + TILE * 10;
      if (train.direction > 0 && train.x > maxX) train.x = -TILE * 8;
      if (train.direction < 0 && train.x < -TILE * 10) train.x = maxX;
      drawTrain(ctx, train, frame);
    });

    // 16. Workers
    workersRef.current.forEach((w) => {
      const target = w.path[w.pathIdx % w.path.length];
      const dx = target.x - w.x;
      const dy = target.y - w.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < w.speed) {
        w.x = target.x;
        w.y = target.y;
        w.pathIdx = (w.pathIdx + 1) % w.path.length;
      } else {
        w.x += (dx / dist) * w.speed;
        w.y += (dy / dist) * w.speed;
        w.facingRight = dx > 0;
      }
      w.frame++;
      drawWorker(ctx, w);
    });

    // 17. Selection highlight
    if (selectedEntityRef.current) {
      const ent = selectedEntityRef.current;
      const sx = ent.col * TILE;
      const sy = ent.row * TILE;
      const sw = ent.tileW * TILE;
      const sh = ent.tileH * TILE;
      const pulse = 0.6 + Math.sin(frame * 0.1) * 0.4;
      ctx.save();
      ctx.strokeStyle = `rgba(0,255,255,${pulse})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 12 * pulse;
      ctx.strokeRect(sx - 2, sy - 2, sw + 4, sh + 4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(0,255,255,${pulse})`;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("▼", sx + sw / 2, sy - 6);
      ctx.restore();
    }

    // Advance state
    beltOffsetRef.current = (beltOffsetRef.current + 0.5) % 18;
    gearRotRef.current += 1;
    frameRef.current++;

    animRef.current = requestAnimationFrame(gameLoop);
  }, [spawnBeltItem]);

  // Start game loop + DB polling
  useEffect(() => {
    animRef.current = requestAnimationFrame(gameLoop);
    loadFactoryState();
    const poll = setInterval(loadFactoryState, 12_000);
    return () => {
      cancelAnimationFrame(animRef.current);
      clearInterval(poll);
    };
  }, [gameLoop, loadFactoryState]);

  // ── Render ──
  return (
    <div
      className="relative w-full overflow-hidden bg-[#222210]"
      style={{ height: "calc(100vh - 64px)" }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
      />

      {/* Entity detail panel */}
      {selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity}
          details={entityDetails}
          loading={detailsLoading}
          onClose={() => { setSelectedEntity(null); setEntityDetails(null); }}
          onNavigate={() => navigate(`/mavis?entity=${encodeURIComponent(selectedEntity.name)}`)}
        />
      )}

      {/* HUD overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 px-4 py-2 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-amber-400 text-sm font-bold tracking-widest uppercase">
              Factory Floor
            </span>
            <span className="font-mono text-[10px] text-amber-400/50">
              MAVIS Production Network — CODEXOS
            </span>
          </div>

          <div className="flex gap-5 font-mono text-xs text-zinc-300">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_#22ff44]" />
              <span className="text-green-400 font-bold">{activeCount}</span>
              <span className="text-zinc-500 text-[10px]">ACTIVE</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400 shadow-[0_0_6px_#ffcc00]" />
              <span className="text-yellow-400 font-bold">{warmCount}</span>
              <span className="text-zinc-500 text-[10px]">WARM</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-600" />
              <span className="text-zinc-500 font-bold">{idleCount}</span>
              <span className="text-zinc-600 text-[10px]">IDLE</span>
            </span>
            <span className="text-amber-400/70 text-[10px] flex items-center gap-1">
              ITEMS/MIN: <span className="text-amber-400 font-bold ml-1">{itemsPerMin}</span>
            </span>
            <span className="text-cyan-400/70 text-[10px] flex items-center gap-1">
              QUESTS: <span className="text-cyan-400 font-bold ml-1">{machineStates.activeQuests}</span>
            </span>
            <span className="text-orange-400/70 text-[10px] flex items-center gap-1">
              ORDERS: <span className="text-orange-400 font-bold ml-1">{machineStates.activeOrders}</span>
            </span>
          </div>

          <button
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 font-mono text-xs transition-colors"
            onClick={loadFactoryState}
            disabled={loading}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "Syncing…" : "Refresh"}
          </button>
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 px-4 py-2 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex flex-wrap gap-3 font-mono text-[9px] text-zinc-500">
            {([
              { color: ITEM_COLORS.memory, label: "Memory" },
              { color: ITEM_COLORS.journal, label: "Journal" },
              { color: ITEM_COLORS.quest, label: "Quest" },
              { color: ITEM_COLORS.ruview, label: "RuView" },
              { color: ITEM_COLORS.order, label: "Orders" },
              { color: ITEM_COLORS.persona, label: "Persona" },
              { color: ITEM_COLORS.council, label: "Council" },
              { color: ITEM_COLORS.processed, label: "Processed" },
            ] as const).map((item) => (
              <span key={item.label} className="flex items-center gap-1">
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-white/10"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-2 text-[9px] font-mono">
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 rounded-sm" style={{ background: "#c8a800" }} />
                <span className="text-yellow-600">Normal belt</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 rounded-sm" style={{ background: "#cc3333" }} />
                <span className="text-red-600">Fast belt</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-5 h-2 rounded-sm" style={{ background: "#3366cc" }} />
                <span className="text-blue-500">Express belt</span>
              </span>
            </div>

            <button
              className="pointer-events-auto font-mono text-[10px] text-violet-400/60 hover:text-violet-300 transition-colors"
              onClick={() => navigate("/mavis")}
            >
              Chat with MAVIS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
