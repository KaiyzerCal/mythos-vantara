// ============================================================
// VANTARA.EXE — FactoryPage v2 (MAVIS Command Floor)
// 12 production zones · 276 edge functions · live telemetry
// MAVIS directs signal packets across all systems in real-time
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

// ── Canvas constants ────────────────────────────────────────
const TILE = 32;
const V_COLS = 110;  // virtual canvas width in tiles
const V_ROWS = 73;   // virtual canvas height in tiles

// ── Types ───────────────────────────────────────────────────
type NodeStatus = "active" | "warm" | "idle";

interface ZoneNode {
  label: string;
  sub?: string;
  dc: number; dr: number;  // relative to zone top-left
  w: number; h: number;
  color: string;
  accent: string;
  light: string;
  cron?: string;
  route?: string;
}

interface ZoneDef {
  id: string;
  label: string;
  description: string;
  col: number; row: number;
  w: number; h: number;
  color: string;
  border: string;
  accent: string;
  light: string;
  nodes: ZoneNode[];
  route?: string;
  statKey?: string;
}

interface SignalPacket {
  x: number; y: number;
  path: { x: number; y: number }[];
  pathIdx: number;
  color: string;
  speed: number;
  opacity: number;
  fading: boolean;
  zoneId: string;
}

interface Smoke {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
}

interface LiveStats {
  activeTasks: number;
  pendingActions: number;
  recentActivity: number;
  personas: number;
  councils: number;
  goals: number;
  quests: number;
  orders: number;
  memories: number;
  journals: number;
  leads: number;
  zoneActivity: Record<string, number>;
}

// ── Zone layout ─────────────────────────────────────────────
// Cols: Z0@2, Z1@29, Z2@56, Z3@83   (width=24, gap=3)
// Rows: Top@3, Mid@26, Bot@49         (height=20, gap=3)
const ZONE_W = 24;
const ZONE_H = 20;
const COL0 = 2; const COL1 = 29; const COL2 = 56; const COL3 = 83;
const ROW0 = 3; const ROW1 = 26; const ROW2 = 49;

const ZONES: ZoneDef[] = [
  // ── Row 0 ───────────────────────────────────────────────
  {
    id: "memory",
    label: "MEMORY COMPLEX",
    description: "16 functions · consolidation · embedding · learning",
    col: COL0, row: ROW0, w: ZONE_W, h: ZONE_H,
    color: "#0a1222", border: "#1a3060", accent: "#2255aa", light: "#4488ff",
    route: "/memory",
    nodes: [
      { label: "MEM·CONSOLIDATE", sub: "daily", dc: 1, dr: 2, w: 5, h: 4, color: "#0d1a2a", accent: "#2255aa", light: "#4488ff", cron: "daily" },
      { label: "BRAIN·CORE",      sub: "weekly", dc: 7, dr: 2, w: 7, h: 6, color: "#0a1525", accent: "#1a4488", light: "#2266cc", cron: "weekly" },
      { label: "LEARN·ENGINE",    sub: "midnight", dc: 15, dr: 2, w: 5, h: 4, color: "#0d1a2a", accent: "#2255aa", light: "#4488ff", cron: "midnight" },
      { label: "KNOWLEDGE",       sub: "on-demand", dc: 1, dr: 11, w: 5, h: 4, color: "#0d1a2a", accent: "#2255aa", light: "#4488ff" },
      { label: "SPACED·REP",      sub: "daily", dc: 8, dr: 12, w: 4, h: 3, color: "#0d1a2a", accent: "#2255aa", light: "#4488ff" },
      { label: "MEM0·SYNC",       sub: "on-demand", dc: 15, dr: 11, w: 5, h: 4, color: "#0d1a2a", accent: "#2255aa", light: "#4488ff" },
    ],
  },
  {
    id: "aicore",
    label: "AI CORE — MAVIS PRIME",
    description: "Orchestrator · Planner · Director · Crew · Actions",
    col: COL1, row: ROW0, w: ZONE_W, h: ZONE_H,
    color: "#0d0820", border: "#4a1090", accent: "#6b21d8", light: "#a855f7",
    route: "/mavis",
    nodes: [
      { label: "PLANNER",  sub: "on-demand", dc: 1,  dr: 2,  w: 4, h: 3, color: "#130d2a", accent: "#5a19b8", light: "#9845e7" },
      { label: "DIRECTOR", sub: "on-demand", dc: 18, dr: 2,  w: 4, h: 3, color: "#130d2a", accent: "#5a19b8", light: "#9845e7" },
      { label: "CREW·ORCH",sub: "on-demand", dc: 1,  dr: 14, w: 4, h: 4, color: "#130d2a", accent: "#5a19b8", light: "#9845e7" },
      { label: "ACTIONS",  sub: "on-demand", dc: 18, dr: 14, w: 4, h: 4, color: "#130d2a", accent: "#5a19b8", light: "#9845e7" },
    ],
    // MAVIS PRIME machine drawn separately at dc=7,dr=4,w=9,h=11
  },
  {
    id: "intel",
    label: "INTELLIGENCE OPS",
    description: "14 functions · world model · market · research",
    col: COL2, row: ROW0, w: ZONE_W, h: ZONE_H,
    color: "#0a1a0a", border: "#1a4a20", accent: "#1a7a30", light: "#22cc44",
    route: "/intelligence",
    nodes: [
      { label: "WORLD·MODEL",  sub: "weekly",  dc: 1, dr: 2, w: 5, h: 5, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44" },
      { label: "MARKET·RADAR", sub: "6:30am",  dc: 8, dr: 2, w: 5, h: 4, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44", cron: "daily" },
      { label: "WORLD·MONITOR",sub: "live",    dc: 15,dr: 2, w: 6, h: 4, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44" },
      { label: "DEEP·RESEARCH",sub: "on-demand",dc:1, dr: 11, w: 5, h: 5, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44" },
      { label: "COMP·INTEL",   sub: "weekly",  dc: 8, dr: 12, w: 5, h: 4, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44" },
      { label: "PREDICTIVE",   sub: "pg_cron", dc: 15,dr: 11, w: 6, h: 5, color: "#0a1a0a", accent: "#1a5a22", light: "#22aa44", cron: "cron" },
    ],
  },
  {
    id: "health",
    label: "HEALTH STATION",
    description: "10 functions · biometrics · wearables · wellness",
    col: COL3, row: ROW0, w: ZONE_W, h: ZONE_H,
    color: "#0f0a1a", border: "#3a1060", accent: "#7c3aed", light: "#00ffcc",
    route: "/health",
    nodes: [
      { label: "HEALTH·MON", sub: "hourly",  dc: 1, dr: 2, w: 5, h: 5, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc", cron: "hourly" },
      { label: "BIO·STATE",  sub: "live",    dc: 8, dr: 2, w: 5, h: 4, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc" },
      { label: "GALAXY·RING",sub: "sync",    dc: 15,dr: 2, w: 6, h: 4, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc" },
      { label: "SLEEP·COACH",sub: "daily",   dc: 1, dr: 12, w: 5, h: 5, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc" },
      { label: "WHOOP·SYNC", sub: "sync",    dc: 8, dr: 12, w: 5, h: 4, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc" },
      { label: "OURA·SYNC",  sub: "sync",    dc: 15,dr: 12, w: 6, h: 4, color: "#0f0a1a", accent: "#5a1a90", light: "#00eecc" },
    ],
  },

  // ── Row 1 ───────────────────────────────────────────────
  {
    id: "comm",
    label: "COMMUNICATION HUB",
    description: "18 functions · email · SMS · phone · Telegram · voice",
    col: COL0, row: ROW1, w: ZONE_W, h: ZONE_H,
    color: "#1a0a08", border: "#6a2010", accent: "#cc4422", light: "#ff6644",
    route: "/inbox",
    nodes: [
      { label: "EMAIL·SEND",  sub: "on-demand",dc: 1,  dr: 2,  w: 5, h: 4, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
      { label: "SMS·WHATSAPP",sub: "on-demand",dc: 8,  dr: 2,  w: 5, h: 4, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
      { label: "PHONE·CALL",  sub: "VAPI",    dc: 15, dr: 2,  w: 6, h: 4, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
      { label: "TELEGRAM·BOT",sub: "live",    dc: 1,  dr: 11, w: 5, h: 5, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
      { label: "VOICEBOX",    sub: "on-demand",dc: 8,  dr: 12, w: 5, h: 4, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
      { label: "PUSH·NOTIFY", sub: "on-demand",dc:15,  dr: 12, w: 6, h: 4, color: "#1a0a08", accent: "#aa3311", light: "#ff5533" },
    ],
  },
  {
    id: "autonomous",
    label: "AUTONOMOUS SYSTEMS",
    description: "10 functions · goal-agent · campaign · trigger engine",
    col: COL1, row: ROW1, w: ZONE_W, h: ZONE_H,
    color: "#0a100a", border: "#1a5a1a", accent: "#22aa44", light: "#44ff88",
    route: "/agents",
    nodes: [
      { label: "AUTO·ENGINE",  sub: "live",  dc: 1, dr: 2, w: 6, h: 5, color: "#0a100a", accent: "#1a8833", light: "#33dd66" },
      { label: "GOAL·AGENT",   sub: "4h",    dc: 9, dr: 2, w: 5, h: 4, color: "#0a100a", accent: "#1a8833", light: "#33dd66", cron: "4h" },
      { label: "CAMPAIGN·RUN", sub: "4h",    dc: 16,dr: 2, w: 5, h: 4, color: "#0a100a", accent: "#1a8833", light: "#33dd66", cron: "4h" },
      { label: "TRIGGER·ENG",  sub: "5min",  dc: 1, dr: 12, w: 5, h: 4, color: "#0a100a", accent: "#1a8833", light: "#33dd66", cron: "5min" },
      { label: "PROACTIVE",    sub: "live",  dc: 8, dr: 12, w: 5, h: 4, color: "#0a100a", accent: "#1a8833", light: "#33dd66" },
      { label: "OUTCOME·TRACK",sub: "daily", dc: 15,dr: 12, w: 6, h: 4, color: "#0a100a", accent: "#1a8833", light: "#33dd66", cron: "daily" },
    ],
  },
  {
    id: "integration",
    label: "INTEGRATION GRID",
    description: "25 functions · Gmail · Drive · Notion · Calendar · Spotify",
    col: COL2, row: ROW1, w: ZONE_W, h: ZONE_H,
    color: "#0a0a1a", border: "#1a1a6a", accent: "#2244cc", light: "#4477ff",
    route: "/integrations",
    nodes: [
      { label: "GMAIL·SYNC",    sub: "daily",  dc: 1, dr: 2,  w: 5, h: 4, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff", cron: "daily" },
      { label: "GDRIVE·SYNC",   sub: "6:00am", dc: 8, dr: 2,  w: 5, h: 4, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff", cron: "daily" },
      { label: "NOTION·SYNC",   sub: "on-demand",dc:15,dr: 2, w: 6, h: 4, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff" },
      { label: "CALENDAR·SYNC", sub: "on-demand",dc: 1,dr: 11, w: 5, h: 5, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff" },
      { label: "SPOTIFY·SYNC",  sub: "on-demand",dc: 8,dr: 12, w: 5, h: 4, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff" },
      { label: "G·CONTACTS",    sub: "on-demand",dc:15,dr: 12, w: 6, h: 4, color: "#0a0a1a", accent: "#1a33aa", light: "#3366ff" },
    ],
  },
  {
    id: "social",
    label: "SOCIAL ENGINE",
    description: "20 functions · Nora · Instagram · Twitter · LinkedIn · TikTok",
    col: COL3, row: ROW1, w: ZONE_W, h: ZONE_H,
    color: "#1a0a00", border: "#5a2a00", accent: "#cc7700", light: "#ffaa00",
    route: "/analytics",
    nodes: [
      { label: "NORA·POST",    sub: "scheduled",dc: 1, dr: 2,  w: 5, h: 4, color: "#1a0a00", accent: "#aa6600", light: "#ff9900" },
      { label: "SOCIAL·SCHED", sub: "hourly",   dc: 8, dr: 2,  w: 5, h: 4, color: "#1a0a00", accent: "#aa6600", light: "#ff9900", cron: "hourly" },
      { label: "CONTENT·PIPE", sub: "on-demand",dc: 15,dr: 2,  w: 6, h: 4, color: "#1a0a00", accent: "#aa6600", light: "#ff9900" },
      { label: "MORN·DIGEST",  sub: "7:00am",   dc: 1, dr: 11, w: 5, h: 5, color: "#1a0a00", accent: "#aa6600", light: "#ff9900", cron: "daily" },
      { label: "INSTAGRAM",    sub: "on-demand",dc: 8, dr: 12, w: 5, h: 4, color: "#1a0a00", accent: "#aa6600", light: "#ff9900" },
      { label: "TWITTER·AGENT",sub: "on-demand",dc: 15,dr: 12, w: 6, h: 4, color: "#1a0a00", accent: "#aa6600", light: "#ff9900" },
    ],
  },

  // ── Row 2 ───────────────────────────────────────────────
  {
    id: "code",
    label: "CODE & WEB LAB",
    description: "12 functions · code-agent · browser · GitHub · web-builder",
    col: COL0, row: ROW2, w: ZONE_W, h: ZONE_H,
    color: "#0a0a00", border: "#3a3a00", accent: "#888800", light: "#cccc00",
    route: "/workflows",
    nodes: [
      { label: "CODE·AGENT",  sub: "on-demand",dc: 1, dr: 2,  w: 6, h: 5, color: "#0a0a00", accent: "#666600", light: "#aaaa00" },
      { label: "BROWSER·AGENT",sub:"on-demand",dc: 9, dr: 2,  w: 5, h: 4, color: "#0a0a00", accent: "#666600", light: "#aaaa00" },
      { label: "GITHUB·SYNC", sub: "on-demand",dc: 16,dr: 2,  w: 5, h: 4, color: "#0a0a00", accent: "#666600", light: "#aaaa00" },
      { label: "WEB·BUILDER", sub: "on-demand",dc: 1, dr: 12, w: 5, h: 4, color: "#0a0a00", accent: "#666600", light: "#aaaa00", route: "/websites" },
      { label: "PYTHON·EXEC", sub: "on-demand",dc: 8, dr: 12, w: 5, h: 4, color: "#0a0a00", accent: "#666600", light: "#aaaa00" },
      { label: "WEB·SCRAPER", sub: "on-demand",dc: 15,dr: 12, w: 6, h: 4, color: "#0a0a00", accent: "#666600", light: "#aaaa00" },
    ],
  },
  {
    id: "analytics",
    label: "ANALYTICS CORE",
    description: "12 functions · scoring · eval · stock · finance · patterns",
    col: COL1, row: ROW2, w: ZONE_W, h: ZONE_H,
    color: "#100808", border: "#501020", accent: "#aa2244", light: "#ff4466",
    route: "/analytics",
    nodes: [
      { label: "DAILY·SCORES", sub: "daily",  dc: 1, dr: 2,  w: 5, h: 4, color: "#100808", accent: "#881133", light: "#ee3355", cron: "daily" },
      { label: "EVAL·SCORES",  sub: "weekly", dc: 8, dr: 2,  w: 5, h: 4, color: "#100808", accent: "#881133", light: "#ee3355", cron: "weekly" },
      { label: "STOCK·ANALYSIS",sub:"on-demand",dc:15,dr: 2, w: 6, h: 4, color: "#100808", accent: "#881133", light: "#ee3355" },
      { label: "PATTERN·INSGHT",sub:"weekly", dc: 1, dr: 11, w: 5, h: 5, color: "#100808", accent: "#881133", light: "#ee3355", cron: "weekly" },
      { label: "FINANCE",      sub: "on-demand",dc: 8,dr: 12, w: 5, h: 4, color: "#100808", accent: "#881133", light: "#ee3355", route: "/finance" },
      { label: "MARKET·DATA",  sub: "live",   dc: 15,dr: 12, w: 6, h: 4, color: "#100808", accent: "#881133", light: "#ee3355" },
    ],
  },
  {
    id: "media",
    label: "MEDIA STUDIO",
    description: "14 functions · image-gen · video · HeyGen · design · YouTube",
    col: COL2, row: ROW2, w: ZONE_W, h: ZONE_H,
    color: "#0a0a18", border: "#2a2a60", accent: "#4444cc", light: "#8888ff",
    route: "/creator",
    nodes: [
      { label: "IMAGE·GEN",   sub: "on-demand",dc: 1, dr: 2,  w: 5, h: 4, color: "#0a0a18", accent: "#3333aa", light: "#7777ee" },
      { label: "VIDEO·GEN",   sub: "on-demand",dc: 8, dr: 2,  w: 5, h: 5, color: "#0a0a18", accent: "#3333aa", light: "#7777ee" },
      { label: "HEYGEN·AGENT",sub: "on-demand",dc: 15,dr: 2,  w: 6, h: 4, color: "#0a0a18", accent: "#3333aa", light: "#7777ee" },
      { label: "DESIGN·ENGINE",sub:"on-demand",dc: 1, dr: 12, w: 5, h: 5, color: "#0a0a18", accent: "#3333aa", light: "#7777ee", route: "/design-studio" },
      { label: "YOUTUBE·AGENT",sub:"on-demand",dc: 8, dr: 12, w: 5, h: 4, color: "#0a0a18", accent: "#3333aa", light: "#7777ee" },
      { label: "PDF·GEN",     sub: "on-demand",dc: 15,dr: 12, w: 6, h: 4, color: "#0a0a18", accent: "#3333aa", light: "#7777ee" },
    ],
  },
  {
    id: "persona",
    label: "PERSONA LAB",
    description: "12 functions · forge · router · emotion · brand voice · identity",
    col: COL3, row: ROW2, w: ZONE_W, h: ZONE_H,
    color: "#0a1208", border: "#224422", accent: "#448833", light: "#88ee44",
    route: "/personas",
    nodes: [
      { label: "PERSONA·FORGE", sub: "on-demand",dc: 1, dr: 2,  w: 6, h: 5, color: "#0a1208", accent: "#336622", light: "#77dd33" },
      { label: "PERSONA·ROUTER",sub: "live",    dc: 9, dr: 2,  w: 5, h: 4, color: "#0a1208", accent: "#336622", light: "#77dd33" },
      { label: "EMOTION·ENGINE",sub: "on-demand",dc:16,dr: 2,  w: 5, h: 4, color: "#0a1208", accent: "#336622", light: "#77dd33" },
      { label: "BRAND·VOICE",  sub: "on-demand",dc: 1, dr: 12, w: 5, h: 4, color: "#0a1208", accent: "#336622", light: "#77dd33" },
      { label: "AGENT·IDENTITY",sub:"on-demand",dc: 8, dr: 12, w: 5, h: 4, color: "#0a1208", accent: "#336622", light: "#77dd33" },
      { label: "GOAL·JUDGE",   sub: "pg_cron", dc: 15,dr: 12, w: 6, h: 4, color: "#0a1208", accent: "#336622", light: "#77dd33", cron: "cron" },
    ],
  },
];

// ── Signal packet paths from MAVIS (tile coords → pixel coords) ─
// MAVIS center: col=41, row=13 (center of AI CORE zone)
const T = (c: number, r: number) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
const SIGNAL_PATHS: Record<string, { x: number; y: number }[]> = {
  memory:      [T(41,13), T(27,13), T(27,5),  T(14,5)],
  intel:       [T(41,13), T(55,13), T(68,13)],
  health:      [T(41,13), T(82,13), T(95,13)],
  comm:        [T(41,13), T(27,13), T(27,24), T(14,24), T(14,35)],
  autonomous:  [T(41,13), T(41,24), T(41,35)],
  integration: [T(41,13), T(55,13), T(55,24), T(68,35)],
  social:      [T(41,13), T(82,13), T(82,24), T(95,35)],
  code:        [T(41,13), T(27,13), T(27,47), T(14,47), T(14,58)],
  analytics:   [T(41,13), T(41,47), T(41,58)],
  media:       [T(41,13), T(55,13), T(55,47), T(68,58)],
  persona:     [T(41,13), T(82,13), T(82,47), T(95,58)],
};

const ZONE_LIGHT_MAP: Record<string, string> = {
  memory: "#4488ff", aicore: "#a855f7", intel: "#22cc44", health: "#00ffcc",
  comm: "#ff6644", autonomous: "#44ff88", integration: "#4477ff", social: "#ffaa00",
  code: "#cccc00", analytics: "#ff4466", media: "#8888ff", persona: "#88ee44",
};

const MAVIS_DIRECTIVES: Record<string, string[]> = {
  memory:      ["Consolidating 47 embeddings…", "Pruning stale memories…", "Distilling behavioral patterns…"],
  intel:       ["Updating world model…", "Scanning market signals…", "Deep-researching competitor moves…"],
  health:      ["Syncing biometric state…", "Analyzing sleep score…", "Querying Galaxy Ring data…"],
  comm:        ["Dispatching email queue…", "Routing Telegram messages…", "Triggering VAPI call…"],
  autonomous:  ["Running goal-agent cycle…", "Firing campaign batch…", "Evaluating trigger conditions…"],
  integration: ["Syncing Gmail labels…", "Pulling Notion updates…", "Refreshing calendar feed…"],
  social:      ["Scheduling Nora posts…", "Publishing content batch…", "Queuing morning digest…"],
  code:        ["Running browser agent task…", "Committing GitHub changes…", "Executing Python script…"],
  analytics:   ["Computing daily scores…", "Running eval suite…", "Scanning pattern insights…"],
  media:       ["Generating DALL-E image…", "Queuing HeyGen avatar…", "Exporting design bundle…"],
  persona:     ["Forging Nora persona update…", "Routing emotion state…", "Auditing brand voice…"],
};

// ── Seeded pseudo-random ────────────────────────────────────
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

// ── Color helpers ────────────────────────────────────────────
function lightenColor(hex: string, amount: number): string {
  if (!hex.startsWith("#")) return hex;
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}
function darkenColor(hex: string, amount: number): string {
  if (!hex.startsWith("#")) return hex;
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

// ── Terrain ──────────────────────────────────────────────────
function drawTerrain(ctx: CanvasRenderingContext2D, panX: number, panY: number, vw: number, vh: number) {
  const startC = Math.max(0, Math.floor(panX / TILE));
  const startR = Math.max(0, Math.floor(panY / TILE));
  const endC   = Math.min(V_COLS, startC + Math.ceil(vw / TILE) + 2);
  const endR   = Math.min(V_ROWS, startR + Math.ceil(vh / TILE) + 2);
  for (let r = startR; r < endR; r++) {
    for (let c = startC; c < endC; c++) {
      const n1 = seededRand(c * 137 + r * 251);
      const n2 = seededRand(c * 79  + r * 317 + 1000);
      const n3 = seededRand(c * 199 + r * 53  + 2000);
      const tr = Math.floor(30 + n1 * 12 + n2 * 4);
      const tg = Math.floor(27 + n1 * 8  + n3 * 4);
      const tb = Math.floor(14 + n2 * 8);
      ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
      ctx.fillRect(c * TILE - panX, r * TILE - panY, TILE, TILE);
      // grain dots
      if (seededRand(c * 311 + r * 127 + 5555) > 0.88) {
        ctx.fillStyle = `rgba(80,70,40,${0.3 + seededRand(c * 211 + r * 97 + 9999) * 0.3})`;
        ctx.fillRect(c * TILE - panX + 12, r * TILE - panY + 12, 3, 3);
      }
    }
  }
}

// ── Zone background ──────────────────────────────────────────
function drawZoneBg(
  ctx: CanvasRenderingContext2D, z: ZoneDef,
  panX: number, panY: number, tickCounter: number
) {
  const px = z.col * TILE - panX;
  const py = z.row * TILE - panY;
  const w  = z.w * TILE;
  const h  = z.h * TILE;

  // Zone fill
  ctx.fillStyle = z.color;
  ctx.fillRect(px, py, w, h);

  // Subtle grid
  ctx.strokeStyle = `${z.accent}18`;
  ctx.lineWidth = 0.5;
  for (let dc = 0; dc <= z.w; dc++) {
    ctx.beginPath(); ctx.moveTo(px + dc * TILE, py); ctx.lineTo(px + dc * TILE, py + h); ctx.stroke();
  }
  for (let dr = 0; dr <= z.h; dr++) {
    ctx.beginPath(); ctx.moveTo(px, py + dr * TILE); ctx.lineTo(px + w, py + dr * TILE); ctx.stroke();
  }

  // Border glow
  ctx.shadowColor = z.accent;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = z.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  ctx.shadowBlur = 0;

  // Header bar
  ctx.fillStyle = `${z.accent}33`;
  ctx.fillRect(px, py, w, 22);

  // Zone label
  ctx.fillStyle = z.light;
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.fillText(z.label, px + 8, py + 15);

  // Corner accent dots (pulsing)
  const pulse = 0.4 + 0.4 * Math.sin(tickCounter * 0.04 + z.col * 0.5);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = z.light;
  for (const [cx, cy] of [[px,py],[px+w-4,py],[px,py+h-4],[px+w-4,py+h-4]]) {
    ctx.fillRect(cx, cy, 4, 4);
  }
  ctx.globalAlpha = 1;
}

// ── Zone machine node ────────────────────────────────────────
function drawNode(
  ctx: CanvasRenderingContext2D, node: ZoneNode,
  zoneCol: number, zoneRow: number,
  panX: number, panY: number,
  status: NodeStatus, tickCounter: number
) {
  const px = (zoneCol + node.dc) * TILE - panX;
  const py = (zoneRow + node.dr) * TILE - panY;
  const w  = node.w * TILE;
  const h  = node.h * TILE;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(px + 3, py + 3, w, h);

  // Body
  const grad = ctx.createLinearGradient(px, py, px, py + h);
  grad.addColorStop(0, lightenColor(node.color, 12));
  grad.addColorStop(1, node.color);
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, w, h);

  // Accent border
  ctx.strokeStyle = node.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 0.75, py + 0.75, w - 1.5, h - 1.5);

  // Top accent stripe
  ctx.fillStyle = node.accent;
  ctx.fillRect(px, py, w, 4);

  // Status light
  const lightOn = status === "active"
    ? 0.65 + 0.35 * Math.sin(tickCounter * 0.09 + node.dc)
    : status === "warm" ? 0.45 : 0.18;
  ctx.globalAlpha = lightOn;
  ctx.fillStyle = node.light;
  ctx.shadowColor = node.light;
  ctx.shadowBlur = status === "active" ? 8 : 0;
  ctx.beginPath();
  ctx.arc(px + w - 8, py + 12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Cron badge
  if (node.cron) {
    ctx.fillStyle = "rgba(200,180,80,0.2)";
    ctx.fillRect(px + 3, py + 6, node.cron.length * 5 + 6, 11);
    ctx.fillStyle = "#ccaa44";
    ctx.font = "6px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`⏱ ${node.cron}`, px + 6, py + 14);
  }

  // Label
  ctx.fillStyle = "rgba(255,255,230,0.88)";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  const mid = py + (node.cron ? h / 2 + 2 : h / 2);
  ctx.fillText(node.label, px + w / 2, mid);

  if (node.sub && !node.cron) {
    ctx.fillStyle = "rgba(200,200,180,0.45)";
    ctx.font = "6px monospace";
    ctx.fillText(node.sub, px + w / 2, mid + 9);
  }

  // Activity scanline
  if (status === "active") {
    const scanY = (tickCounter * 0.4 + node.dc * 7) % h;
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = node.light;
    ctx.fillRect(px, py + scanY, w, 3);
    ctx.globalAlpha = 1;
  }
}

// ── MAVIS PRIME machine ──────────────────────────────────────
function drawGear(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  r: number, angle: number, fill: string
) {
  const teeth = 10; const innerR = r * 0.6; const toothW = (Math.PI * 2 / teeth) * 0.38;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    ctx.moveTo(Math.cos(a - toothW) * innerR, Math.sin(a - toothW) * innerR);
    ctx.lineTo(Math.cos(a - toothW) * (r + r * 0.25), Math.sin(a - toothW) * (r + r * 0.25));
    ctx.lineTo(Math.cos(a + toothW) * (r + r * 0.25), Math.sin(a + toothW) * (r + r * 0.25));
    ctx.lineTo(Math.cos(a + toothW) * innerR, Math.sin(a + toothW) * innerR);
    ctx.arc(0, 0, innerR, a + toothW, (i + 1) / teeth * Math.PI * 2 - toothW);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lightenColor(fill, 30);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawMAVISPrime(
  ctx: CanvasRenderingContext2D, panX: number, panY: number, tickCounter: number
) {
  // Position: col=35, row=5 within zone (zone col=COL1=29, row=ROW0=3)
  const px = (COL1 + 6) * TILE - panX;
  const py = (ROW0 + 3) * TILE - panY;
  const w  = 10 * TILE;
  const h  = 13 * TILE;
  const cx = px + w / 2;
  const cy = py + h / 2 - 20;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(px + 6, py + 6, w, h);

  // Body gradient
  const grad = ctx.createLinearGradient(px, py, px, py + h);
  grad.addColorStop(0, "#1a0d3a");
  grad.addColorStop(0.5, "#130d2a");
  grad.addColorStop(1, "#0d0820");
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, w, h);

  // Glowing border
  const glow = 0.6 + 0.4 * Math.sin(tickCounter * 0.07);
  ctx.shadowColor = "#8b5cf6";
  ctx.shadowBlur = 16 * glow;
  ctx.strokeStyle = "#6b21d8";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(px + 1, py + 1, w - 2, h - 2);
  ctx.shadowBlur = 0;

  // Top stripe
  const headerGrad = ctx.createLinearGradient(px, py, px + w, py);
  headerGrad.addColorStop(0, "#6b21d8");
  headerGrad.addColorStop(0.5, "#9333ea");
  headerGrad.addColorStop(1, "#6b21d8");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(px, py, w, 5);

  // Gears
  const gAngle = (tickCounter * 0.04) % (Math.PI * 2);
  drawGear(ctx, cx, cy, 26, gAngle,       "#4a1090");
  drawGear(ctx, cx, cy, 18, -gAngle * 1.4,"#6b21d8");

  // Core crystal
  ctx.globalAlpha = glow;
  ctx.fillStyle = "#a855f7";
  ctx.shadowColor = "#a855f7";
  ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Brain wave rings
  for (let i = 0; i < 3; i++) {
    const age = (tickCounter + i * 20) % 60;
    const r = age * 3 + 30;
    const alpha = Math.max(0, 0.35 - age / 60 * 0.35);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Scan line
  const scanY = (tickCounter * 0.5 % h);
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#a855f7";
  ctx.fillRect(px, py + scanY, w, 4);
  ctx.globalAlpha = 1;

  // Labels
  ctx.fillStyle = "#c084fc";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("MAVIS PRIME", cx, py + h - 30);
  ctx.fillStyle = "#7c3aed";
  ctx.font = "8px monospace";
  ctx.fillText("CODEXOS CORE", cx, py + h - 18);

  // Status indicator
  ctx.fillStyle = `rgba(168,85,247,${glow})`;
  ctx.font = "7px monospace";
  ctx.fillText("● ACTIVE", cx, py + h - 7);
}

// ── Corridor belts (static visual) ──────────────────────────
function drawCorridors(ctx: CanvasRenderingContext2D, panX: number, panY: number, tickCounter: number) {
  const stripeOffset = (tickCounter * 0.6) % (TILE * 2);

  // Vertical corridors at cols 26-28, 53-55, 80-82
  for (const startCol of [26, 53, 80]) {
    const x = startCol * TILE - panX;
    const y1 = ROW0 * TILE - panY;
    const y2 = (ROW2 + ZONE_H) * TILE - panY;
    const cw = 3 * TILE;
    ctx.fillStyle = "#111108";
    ctx.fillRect(x, y1, cw, y2 - y1);
    for (let sy = y1 - stripeOffset; sy < y2; sy += TILE * 2) {
      ctx.fillStyle = "rgba(180,160,50,0.12)";
      ctx.fillRect(x + 4, sy, cw - 8, TILE);
    }
    ctx.strokeStyle = "#333320";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y1, cw, y2 - y1);
  }

  // Horizontal corridors at rows 23-25, 46-48
  for (const startRow of [23, 46]) {
    const x1 = COL0 * TILE - panX;
    const y  = startRow * TILE - panY;
    const x2 = (COL3 + ZONE_W) * TILE - panX;
    const ch = 3 * TILE;
    ctx.fillStyle = "#111108";
    ctx.fillRect(x1, y, x2 - x1, ch);
    for (let sx = x1 - stripeOffset * 1.2; sx < x2; sx += TILE * 2) {
      ctx.fillStyle = "rgba(180,160,50,0.12)";
      ctx.fillRect(sx, y + 4, TILE, ch - 8);
    }
    ctx.strokeStyle = "#333320";
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, y, x2 - x1, ch);
  }
}

// ── Power poles ──────────────────────────────────────────────
function drawPowerPoles(ctx: CanvasRenderingContext2D, panX: number, panY: number) {
  const polePositions = [
    { c: 14, r: 13 }, { c: 41, r: 3  }, { c: 68, r: 13 }, { c: 95, r: 13 },
    { c: 14, r: 36 }, { c: 41, r: 36 }, { c: 68, r: 36 }, { c: 95, r: 36 },
    { c: 14, r: 59 }, { c: 41, r: 59 }, { c: 68, r: 59 }, { c: 95, r: 59 },
  ];
  ctx.strokeStyle = "#cc9944";
  ctx.lineWidth = 1;

  polePositions.forEach(({ c, r }) => {
    const px = c * TILE - panX + TILE / 2;
    const py = r * TILE - panY;
    ctx.fillStyle = "#556655";
    ctx.fillRect(px - 2, py, 4, TILE + 4);
    ctx.fillStyle = "#334433";
    ctx.fillRect(px - 6, py + 4, 12, 4);
    // Wire dots
    ctx.fillStyle = "#cc8833";
    ctx.beginPath(); ctx.arc(px - 5, py + 6, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 5, py + 6, 2, 0, Math.PI * 2); ctx.fill();
  });
}

// ── Signal packets ────────────────────────────────────────────
function updateAndDrawSignals(
  ctx: CanvasRenderingContext2D, packets: SignalPacket[], panX: number, panY: number
) {
  for (let i = packets.length - 1; i >= 0; i--) {
    const p = packets[i];
    if (p.fading) {
      p.opacity -= 0.025;
      if (p.opacity <= 0) { packets.splice(i, 1); continue; }
    } else if (p.pathIdx < p.path.length) {
      const target = p.path[p.pathIdx];
      const dx = target.x - p.x; const dy = target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.speed) { p.x = target.x; p.y = target.y; p.pathIdx++; }
      else { p.x += (dx / dist) * p.speed; p.y += (dy / dist) * p.speed; }
    } else {
      p.fading = true;
    }

    const sx = p.x - panX; const sy = p.y - panY;
    const S = 9;
    ctx.globalAlpha = p.opacity;
    ctx.shadowColor = p.color; ctx.shadowBlur = 10;
    ctx.fillStyle = darkenColor(p.color, 40);
    ctx.fillRect(sx - S / 2 + 2, sy - S / 2 + 2, S, S);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx - S / 2, sy - S / 2, S, S);
    ctx.fillStyle = lightenColor(p.color, 60);
    ctx.fillRect(sx - S / 2, sy - S / 2, S * 0.4, S * 0.4);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}

// ── Smoke ────────────────────────────────────────────────────
function updateAndDrawSmoke(ctx: CanvasRenderingContext2D, smokes: Smoke[], panX: number, panY: number) {
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.x += s.vx; s.y += s.vy; s.vx *= 0.97; s.vy *= 0.97;
    s.life -= 0.007;
    if (s.life <= 0) { smokes.splice(i, 1); continue; }
    ctx.globalAlpha = (s.life / s.maxLife) * 0.4;
    ctx.fillStyle = s.color;
    const r = s.size * (1 + (1 - s.life / s.maxLife) * 1.5);
    ctx.beginPath(); ctx.arc(s.x - panX, s.y - panY, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function spawnSmoke(smokes: Smoke[], x: number, y: number, color: string) {
  for (let i = 0; i < 2; i++) {
    smokes.push({
      x: x + (seededRand(x + i) - 0.5) * 8,
      y,
      vx: (seededRand(y + i) - 0.5) * 0.35,
      vy: -0.45 - seededRand(x * y + i) * 0.45,
      life: 1, maxLife: 1,
      size: 4 + seededRand(x + y + i) * 5,
      color,
    });
  }
}

// ── Minimap ──────────────────────────────────────────────────
function drawMinimap(
  ctx: CanvasRenderingContext2D, vw: number, vh: number,
  panX: number, panY: number, zones: ZoneDef[]
) {
  const MM_W = 160; const MM_H = 110;
  const MM_X = vw - MM_W - 12;
  const MM_Y = vh - MM_H - 12;
  const scaleX = MM_W / (V_COLS * TILE);
  const scaleY = MM_H / (V_ROWS * TILE);

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(MM_X - 2, MM_Y - 2, MM_W + 4, MM_H + 4);
  ctx.strokeStyle = "#333322";
  ctx.lineWidth = 1;
  ctx.strokeRect(MM_X - 2, MM_Y - 2, MM_W + 4, MM_H + 4);

  // Zones
  zones.forEach(z => {
    const zx = MM_X + z.col * TILE * scaleX;
    const zy = MM_Y + z.row * TILE * scaleY;
    const zw = z.w * TILE * scaleX;
    const zh = z.h * TILE * scaleY;
    ctx.fillStyle = z.accent + "66";
    ctx.fillRect(zx, zy, zw, zh);
    ctx.strokeStyle = z.accent;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(zx, zy, zw, zh);
  });

  // Viewport rect
  ctx.strokeStyle = "#ffee44";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    MM_X + panX * scaleX,
    MM_Y + panY * scaleY,
    vw * scaleX,
    vh * scaleY
  );

  // Label
  ctx.fillStyle = "rgba(200,180,80,0.6)";
  ctx.font = "7px monospace";
  ctx.textAlign = "left";
  ctx.fillText("SYSTEM MAP", MM_X, MM_Y - 4);
}

// ── Zone stats overlay ────────────────────────────────────────
function drawZoneStatBadge(
  ctx: CanvasRenderingContext2D, z: ZoneDef,
  panX: number, panY: number, stat: number | undefined
) {
  if (stat === undefined) return;
  const px = (z.col + z.w) * TILE - panX - 4;
  const py = z.row * TILE - panY + 4;
  const label = String(stat);
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(px - label.length * 6 - 6, py, label.length * 6 + 8, 14);
  ctx.fillStyle = z.light;
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "right";
  ctx.fillText(label, px, py + 10);
}

// ── MAVIS directive log ───────────────────────────────────────
const MAX_LOG = 6;
type LogEntry = { ts: number; msg: string; color: string };

// ── Relative time helper ─────────────────────────────────────
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── EntityDetailPanel ─────────────────────────────────────────
function EntityDetailPanel({
  zone, onClose, onNavigate, stats,
}: {
  zone: ZoneDef; onClose: () => void; onNavigate: () => void; stats: LiveStats;
}) {
  const stat = zone.statKey ? (stats as any)[zone.statKey] : undefined;
  return (
    <div className="fixed right-4 top-16 bottom-4 w-72 bg-zinc-900 border border-zinc-700 rounded-lg overflow-y-auto flex flex-col shadow-2xl z-50">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-700 sticky top-0 bg-zinc-900">
        <span className="font-mono text-sm font-bold truncate" style={{ color: zone.light }}>{zone.label}</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-white text-lg leading-none">✕</button>
      </div>
      <div className="px-4 py-3 space-y-3 font-mono text-xs text-zinc-300">
        <p className="text-zinc-500">{zone.description}</p>
        {stat !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-500">Active:</span>
            <span className="font-bold" style={{ color: zone.light }}>{stat}</span>
          </div>
        )}
        <div className="border-t border-zinc-800 pt-3">
          <p className="text-zinc-500 mb-2 uppercase tracking-wider text-[9px]">Machines</p>
          {zone.nodes.map(n => (
            <div key={n.label} className="flex items-center gap-2 py-1 border-b border-zinc-800/50">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: n.light }} />
              <span className="text-zinc-300 text-[10px]">{n.label}</span>
              {n.cron && <span className="text-zinc-600 text-[9px] ml-auto">⏱ {n.cron}</span>}
              {n.sub && !n.cron && <span className="text-zinc-600 text-[9px] ml-auto">{n.sub}</span>}
            </div>
          ))}
        </div>
        {zone.route && (
          <button
            onClick={onNavigate}
            className="w-full mt-2 py-2 rounded border font-mono text-xs transition-colors"
            style={{ borderColor: zone.accent + "80", color: zone.light }}
          >
            Open {zone.label.split(" ")[0]} →
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ─ MAIN COMPONENT ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════
export default function FactoryPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const tickRef   = useRef(0);

  // Pan state
  const panRef = useRef({ x: 0, y: 0, startX: 0, startY: 0, dragging: false });
  const [panXY, setPanXY] = useState({ x: 0, y: 0 });

  // Mutable animation data
  const signalsRef = useRef<SignalPacket[]>([]);
  const smokesRef  = useRef<Smoke[]>([]);

  // Dispatch timer
  const lastDispatchRef = useRef(0);
  const dispatchZoneIdxRef = useRef(0);

  // MAVIS log
  const [mavisLog, setMavisLog] = useState<LogEntry[]>([
    { ts: Date.now() - 5000, msg: "MAVIS PRIME → ONLINE · all systems nominal", color: "#a855f7" },
  ]);
  const mavisLogRef = useRef<LogEntry[]>(mavisLog);

  // Clickable selection
  const [selectedZone, setSelectedZone] = useState<ZoneDef | null>(null);

  // Live stats
  const [stats, setStats] = useState<LiveStats>({
    activeTasks: 0, pendingActions: 0, recentActivity: 0,
    personas: 0, councils: 0, goals: 0, quests: 0,
    orders: 0, memories: 0, journals: 0, leads: 0,
    zoneActivity: {},
  });
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  // Node status derived from stats
  const nodeStatusRef = useRef<NodeStatus>("active");

  // ── Data fetch ─────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [
        tasksRes, actRes, personasRes, councilsRes,
        goalsRes, questsRes, ordersRes, memRes, journalRes,
      ] = await Promise.allSettled([
        supabase.from("tasks").select("*", { count: "exact", head: true }).neq("status", "done"),
        supabase.from("activity_log").select("*", { count: "exact", head: true }),
        supabase.from("personas").select("*", { count: "exact", head: true }),
        supabase.from("councils").select("*", { count: "exact", head: true }),
        supabase.from("mavis_goals").select("*", { count: "exact", head: true }),
        supabase.from("quests").select("*", { count: "exact", head: true }),
        supabase.from("standup_order_templates").select("*", { count: "exact", head: true }),
        supabase.from("mavis_notes").select("*", { count: "exact", head: true }),
        supabase.from("journal_entries").select("*", { count: "exact", head: true }),
      ]);

      const get = (res: PromiseSettledResult<any>) =>
        res.status === "fulfilled" ? (res.value.count ?? 0) : 0;

      setStats(prev => ({
        ...prev,
        activeTasks:    get(tasksRes),
        recentActivity: get(actRes),
        personas:       get(personasRes),
        councils:       get(councilsRes),
        goals:          get(goalsRes),
        quests:         get(questsRes),
        orders:         get(ordersRes),
        memories:       get(memRes),
        journals:       get(journalRes),
        zoneActivity: {
          memory:      get(memRes),
          aicore:      get(tasksRes),
          intel:       get(actRes),
          comm:        0,
          autonomous:  get(goalsRes),
          integration: 0,
          social:      get(personasRes),
          analytics:   0,
          persona:     get(personasRes),
          health:      0,
          code:        0,
          media:       0,
        },
      }));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── MAVIS dispatch ──────────────────────────────────────────
  const dispatchSignal = useCallback((zoneId: string) => {
    const path = SIGNAL_PATHS[zoneId];
    if (!path || path.length === 0) return;
    const color = ZONE_LIGHT_MAP[zoneId] ?? "#a855f7";

    signalsRef.current.push({
      x: path[0].x, y: path[0].y,
      path, pathIdx: 1,
      color, speed: 3.5,
      opacity: 1, fading: false,
      zoneId,
    });

    const zone = ZONES.find(z => z.id === zoneId);
    if (zone) {
      const msgs = MAVIS_DIRECTIVES[zoneId] ?? ["Processing…"];
      const msg  = `MAVIS → ${zone.label.split("—")[0].trim()}: ${msgs[Math.floor(msgs.length * ((Date.now() % 1000) / 1000))]}`;
      const entry: LogEntry = { ts: Date.now(), msg, color };
      mavisLogRef.current = [entry, ...mavisLogRef.current].slice(0, MAX_LOG);
      setMavisLog([...mavisLogRef.current]);
    }
  }, []);

  // ── Canvas pan ──────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    panRef.current.dragging = true;
    panRef.current.startX = e.clientX + panRef.current.x;
    panRef.current.startY = e.clientY + panRef.current.y;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!panRef.current.dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxPanX = Math.max(0, V_COLS * TILE - canvas.clientWidth);
    const maxPanY = Math.max(0, V_ROWS * TILE - canvas.clientHeight);
    const nx = Math.max(0, Math.min(maxPanX, panRef.current.startX - e.clientX));
    const ny = Math.max(0, Math.min(maxPanY, panRef.current.startY - e.clientY));
    panRef.current.x = nx;
    panRef.current.y = ny;
    setPanXY({ x: nx, y: ny });
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    panRef.current.dragging = false;
  }, []);

  // ── Click detection ─────────────────────────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (panRef.current.dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + panRef.current.x;
    const my = e.clientY - rect.top  + panRef.current.y;
    const clickC = mx / TILE;
    const clickR = my / TILE;

    for (const z of ZONES) {
      if (clickC >= z.col && clickC < z.col + z.w &&
          clickR >= z.row && clickR < z.row + z.h) {
        setSelectedZone(z);
        dispatchSignal(z.id);
        return;
      }
    }
    setSelectedZone(null);
  }, [dispatchSignal]);

  // ── Game loop ───────────────────────────────────────────────
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = canvas.width;
    const vh = canvas.height;
    const panX = panRef.current.x;
    const panY = panRef.current.y;
    const tick = tickRef.current++;

    // ── Terrain ──────────────────────────────────────────────
    drawTerrain(ctx, panX, panY, vw, vh);

    // ── Corridors ────────────────────────────────────────────
    drawCorridors(ctx, panX, panY, tick);

    // ── Zones ────────────────────────────────────────────────
    for (const z of ZONES) {
      drawZoneBg(ctx, z, panX, panY, tick);
      // Draw nodes
      for (const node of z.nodes) {
        const status: NodeStatus = node.cron ? "active" : "warm";
        drawNode(ctx, node, z.col, z.row, panX, panY, status, tick);
      }
      // MAVIS PRIME special rendering
      if (z.id === "aicore") {
        drawMAVISPrime(ctx, panX, panY, tick);
      }
      // Zone stat badge
      drawZoneStatBadge(ctx, z, panX, panY, (stats.zoneActivity)[z.id]);
    }

    // ── Power poles ──────────────────────────────────────────
    drawPowerPoles(ctx, panX, panY);

    // ── Smoke from active nodes ──────────────────────────────
    if (tick % 12 === 0) {
      // Emit from MAVIS
      const mx = (COL1 + 11) * TILE;
      const my = (ROW0 + 4) * TILE;
      spawnSmoke(smokesRef.current, mx, my, "#5522aa");
      spawnSmoke(smokesRef.current, mx + 20, my, "#330077");
      // Random zone machines
      const rz = ZONES[tick % ZONES.length];
      if (rz.nodes.length > 0) {
        const rn = rz.nodes[tick % rz.nodes.length];
        spawnSmoke(smokesRef.current, (rz.col + rn.dc + rn.w / 2) * TILE, (rz.row + rn.dr) * TILE, rz.accent);
      }
    }
    updateAndDrawSmoke(ctx, smokesRef.current, panX, panY);

    // ── Signal packets ───────────────────────────────────────
    updateAndDrawSignals(ctx, signalsRef.current, panX, panY);

    // ── Auto dispatch ────────────────────────────────────────
    const now = Date.now();
    if (now - lastDispatchRef.current > 4000) {
      lastDispatchRef.current = now;
      const zoneIds = Object.keys(SIGNAL_PATHS);
      const zId = zoneIds[dispatchZoneIdxRef.current % zoneIds.length];
      dispatchZoneIdxRef.current++;
      dispatchSignal(zId);
    }

    // ── Minimap ──────────────────────────────────────────────
    drawMinimap(ctx, vw, vh, panX, panY, ZONES);

    animRef.current = requestAnimationFrame(gameLoop);
  }, [stats, dispatchSignal]);

  // ── Canvas resize observer ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      // Set initial pan to center on MAVIS
      const mx = COL1 * TILE + (ZONE_W / 2) * TILE - canvas.clientWidth / 2;
      const my = ROW0 * TILE + (ZONE_H / 2) * TILE - canvas.clientHeight / 2;
      const cx = Math.max(0, Math.min(V_COLS * TILE - canvas.clientWidth, mx));
      const cy = Math.max(0, Math.min(V_ROWS * TILE - canvas.clientHeight, my));
      panRef.current.x = cx;
      panRef.current.y = cy;
      setPanXY({ x: cx, y: cy });
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(gameLoop);
    const poll = setInterval(loadStats, 30_000);
    return () => {
      cancelAnimationFrame(animRef.current);
      clearInterval(poll);
    };
  }, [gameLoop, loadStats]);

  // ── Totals for HUD ──────────────────────────────────────────
  const totalFunctions  = 276;
  const totalTables     = 203;
  const activeCronCount = 99;

  return (
    <div
      className="relative w-full overflow-hidden bg-[#1a1a0a]"
      style={{ height: "calc(100vh - 64px)", cursor: panRef.current.dragging ? "grabbing" : "grab" }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
        style={{ cursor: "inherit" }}
      />

      {/* ── Entity detail panel ─────────────────────────────── */}
      {selectedZone && (
        <EntityDetailPanel
          zone={selectedZone}
          onClose={() => setSelectedZone(null)}
          onNavigate={() => { if (selectedZone.route) navigate(selectedZone.route); setSelectedZone(null); }}
          stats={stats}
        />
      )}

      {/* ── HUD overlay ────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 px-4 py-2 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
          <div>
            <span className="font-mono text-amber-400 text-sm font-bold tracking-widest">FACTORY FLOOR</span>
            <span className="font-mono text-[9px] text-amber-400/40 ml-3">MAVIS COMMAND — {totalFunctions} FUNCTIONS · {totalTables} TABLES · {activeCronCount} CRONS</span>
          </div>

          <div className="flex gap-4 font-mono text-xs">
            <span className="text-purple-400/80 text-[10px]">
              TASKS <span className="text-purple-300 font-bold ml-1">{stats.activeTasks}</span>
            </span>
            <span className="text-blue-400/80 text-[10px]">
              MEMORIES <span className="text-blue-300 font-bold ml-1">{stats.memories}</span>
            </span>
            <span className="text-green-400/80 text-[10px]">
              GOALS <span className="text-green-300 font-bold ml-1">{stats.goals}</span>
            </span>
            <span className="text-yellow-400/80 text-[10px]">
              PERSONAS <span className="text-yellow-300 font-bold ml-1">{stats.personas}</span>
            </span>
            <span className="text-red-400/80 text-[10px]">
              QUESTS <span className="text-red-300 font-bold ml-1">{stats.quests}</span>
            </span>
            <span className="text-cyan-400/80 text-[10px]">
              ACTIVITY <span className="text-cyan-300 font-bold ml-1">{stats.recentActivity}</span>
            </span>
          </div>

          <button
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/90 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 font-mono text-xs transition-colors"
            onClick={loadStats}
            disabled={loading}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "Syncing…" : "Sync"}
          </button>
        </div>

        {/* MAVIS Directive log — bottom-left */}
        <div className="absolute bottom-3 left-3 w-80 space-y-1">
          <p className="font-mono text-[9px] text-purple-400/50 tracking-widest uppercase mb-1">
            ▸ MAVIS DIRECTIVE LOG
          </p>
          {mavisLog.slice(0, 5).map((entry, i) => (
            <div
              key={entry.ts + i}
              className="font-mono text-[9px] px-2 py-1 rounded bg-black/60 border-l-2 truncate"
              style={{ borderColor: entry.color, color: i === 0 ? entry.color : "rgba(200,200,180,0.5)" }}
            >
              {entry.msg}
              <span className="ml-2 opacity-40">{relativeTime(entry.ts)}</span>
            </div>
          ))}
        </div>

        {/* Zone legend — top-right corner (above minimap) */}
        <div className="absolute bottom-32 right-3 space-y-0.5">
          {ZONES.slice(0, 6).map(z => (
            <div key={z.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: z.light }} />
              <span className="font-mono text-[8px]" style={{ color: z.light + "99" }}>{z.label.split("—")[0].trim()}</span>
            </div>
          ))}
        </div>

        {/* Pan hint */}
        <div className="absolute top-12 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="font-mono text-[9px] text-zinc-600">drag to pan · click zone for details</span>
        </div>
      </div>
    </div>
  );
}
