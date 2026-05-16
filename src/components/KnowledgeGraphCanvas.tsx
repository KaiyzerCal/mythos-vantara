import { useEffect, useRef, useCallback } from "react";

interface GNode {
  id: string;
  title: string;
  tags: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: number;
}

interface GEdge { source: string; target: string; type: string; }

export interface CanvasNote {
  id: string; title: string; tags: string[];
  content: string; created_at: string; updated_at: string;
  properties: Record<string, unknown>; aliases: string[];
}

export interface CanvasLink {
  id: string; source_note_id: string; target_note_id: string;
  type: string; description: string | null; created_at: string;
}

interface Props {
  notes: CanvasNote[];
  links: CanvasLink[];
  selectedId?: string;
  onSelectNote: (note: CanvasNote) => void;
}

const TAG_COLORS = [
  "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#a78bfa", "#34d399",
];

function tagColor(tags: string[]): string {
  if (!tags?.length) return TAG_COLORS[0];
  const hash = tags[0].split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return TAG_COLORS[hash % TAG_COLORS.length];
}

const REPULSION  = 2800;
const SPRING_K   = 0.022;
const REST_LEN   = 140;
const DAMPING    = 0.87;
const CENTER_G   = 0.011;
const BASE_R     = 7;

export default function KnowledgeGraphCanvas({ notes, links, selectedId, onSelectNote }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const nodesRef     = useRef<GNode[]>([]);
  const edgesRef     = useRef<GEdge[]>([]);
  const rafRef       = useRef<number>(0);
  const hoverIdRef   = useRef<string | null>(null);
  const selectedRef  = useRef<string | undefined>(selectedId);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef      = useRef<{ startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const dimRef       = useRef({ W: 800, H: 500 });

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  // ── Simulation + render loop ──────────────────────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = container.offsetWidth  || 800;
    const H = container.offsetHeight || 500;
    canvas.width  = W;
    canvas.height = H;
    dimRef.current = { W, H };

    // Count connections per node for sizing
    const connCount: Record<string, number> = {};
    for (const l of links) {
      connCount[l.source_note_id] = (connCount[l.source_note_id] ?? 0) + 1;
      connCount[l.target_note_id] = (connCount[l.target_note_id] ?? 0) + 1;
    }

    nodesRef.current = notes.map(n => ({
      id: n.id, title: n.title, tags: n.tags ?? [],
      x: W / 2 + (Math.random() - 0.5) * W * 0.55,
      y: H / 2 + (Math.random() - 0.5) * H * 0.55,
      vx: 0, vy: 0,
      connections: connCount[n.id] ?? 0,
    }));

    edgesRef.current = links.map(l => ({
      source: l.source_note_id, target: l.target_note_id, type: l.type,
    }));

    const nodeMap = new Map<string, GNode>(nodesRef.current.map(n => [n.id, n]));

    function tick() {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const cx = W / 2, cy = H / 2;

      // Repulsion O(n²)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const d2 = dx * dx + dy * dy + 1;
          const d  = Math.sqrt(d2);
          const f  = REPULSION / d2;
          nodes[i].vx -= f * dx / d;
          nodes[i].vy -= f * dy / d;
          nodes[j].vx += f * dx / d;
          nodes[j].vy += f * dy / d;
        }
      }

      // Spring forces O(e)
      for (const e of edges) {
        const src = nodeMap.get(e.source);
        const tgt = nodeMap.get(e.target);
        if (!src || !tgt) continue;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const d  = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f  = SPRING_K * (d - REST_LEN);
        src.vx += f * dx / d; src.vy += f * dy / d;
        tgt.vx -= f * dx / d; tgt.vy -= f * dy / d;
      }

      // Center gravity + integrate
      for (const n of nodes) {
        n.vx += (cx - n.x) * CENTER_G;
        n.vy += (cy - n.y) * CENTER_G;
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x  += n.vx;    n.y  += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
      }
    }

    function draw() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const nodes    = nodesRef.current;
      const edges    = edgesRef.current;
      const { x: tx, y: ty, scale } = transformRef.current;
      const hovId    = hoverIdRef.current;
      const selId    = selectedRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#080b18";
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // Subtle grid dots
      ctx.fillStyle = "rgba(139,92,246,0.05)";
      const step = 44;
      for (let gx = 0; gx < W / scale + step; gx += step) {
        for (let gy = 0; gy < H / scale + step; gy += step) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Edges
      for (const e of edges) {
        const src = nodeMap.get(e.source);
        const tgt = nodeMap.get(e.target);
        if (!src || !tgt) continue;
        const active = src.id === selId || tgt.id === selId || src.id === hovId || tgt.id === hovId;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = active ? "rgba(139,92,246,0.75)" : "rgba(139,92,246,0.18)";
        ctx.lineWidth   = active ? 1.5 : 0.75;
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        const isSel = n.id === selId;
        const isHov = n.id === hovId;
        const color  = tagColor(n.tags);
        const r      = BASE_R + Math.sqrt(n.connections) * 2 + (isSel ? 4 : isHov ? 2 : 0);

        // Radial glow
        const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
        gr.addColorStop(0, color + (isSel ? "55" : "30"));
        gr.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();

        // Circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle  = isSel ? "#ffffff" : color + (isHov ? "ee" : "bb");
        ctx.fill();
        ctx.strokeStyle = isSel ? "#ffffff" : color;
        ctx.lineWidth   = isSel ? 2 : 1;
        ctx.stroke();

        // Label: always show when few notes, or on hover/select/connected
        const showLabel = isSel || isHov || nodes.length <= 20 || n.connections >= 2;
        if (showLabel) {
          const label = n.title.length > 22 ? n.title.slice(0, 22) + "…" : n.title;
          ctx.font      = `${isSel ? "bold " : ""}9px monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = isSel ? "#ffffff" : "#c4b5fd";
          ctx.fillText(label, n.x, n.y + r + 12);
        }
      }

      ctx.restore();

      // HUD: note count + hint
      ctx.fillStyle = "rgba(139,92,246,0.5)";
      ctx.font      = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${nodes.length} notes · ${edges.length} links · scroll to zoom · drag to pan`, 10, H - 10);
    }

    function frame() {
      tick();
      draw();
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [notes, links]);

  // ── Wheel zoom (non-passive so preventDefault works) ──────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = canvas.getBoundingClientRect();
      const cx     = e.clientX - rect.left;
      const cy     = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const t      = transformRef.current;
      t.scale = Math.max(0.15, Math.min(5, t.scale * factor));
      t.x     = cx - (cx - t.x) * factor;
      t.y     = cy - (cy - t.y) * factor;
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  // ── Hit test in graph space ───────────────────────────────
  const hitTest = useCallback((cx: number, cy: number): GNode | null => {
    const { x: tx, y: ty, scale } = transformRef.current;
    const gx = (cx - tx) / scale;
    const gy = (cy - ty) / scale;
    for (const n of nodesRef.current) {
      const r  = BASE_R + Math.sqrt(n.connections) * 2 + 5;
      const dx = n.x - gx, dy = n.y - gy;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;

    if (dragRef.current) {
      const d = dragRef.current;
      transformRef.current.x += cx - d.lastX;
      transformRef.current.y += cy - d.lastY;
      d.lastX = cx; d.lastY = cy;
      if (Math.abs(cx - d.startX) > 4 || Math.abs(cy - d.startY) > 4) d.moved = true;
      return;
    }

    const hit = hitTest(cx, cy);
    hoverIdRef.current = hit?.id ?? null;
    if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "grab";
  }, [hitTest]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx   = e.clientX - rect.left;
    const cy   = e.clientY - rect.top;
    dragRef.current = { startX: cx, startY: cy, lastX: cx, lastY: cy, moved: false };
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const wasMoved = dragRef.current?.moved ?? false;
    dragRef.current = null;
    if (!wasMoved) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) {
        const note = { id: hit.id, title: hit.title, tags: hit.tags } as CanvasNote;
        onSelectNote(note);
      }
    }
  }, [hitTest, onSelectNote]);

  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    hoverIdRef.current = null;
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: "grab" }}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );
}
