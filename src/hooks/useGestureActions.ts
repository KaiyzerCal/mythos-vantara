/**
 * useGestureActions — bridges systemMonitor "gesture:action" events to React UI.
 *
 * Subscribes on mount, dispatches each gesture action to the correct
 * UI handler, and cleans up on unmount. Import into the root layout or
 * the voice overlay component so it's always active while the app is open.
 *
 * Supported actions (from gestureCommandMapper.ts):
 *   voice:toggle        → toggle voice overlay open/closed
 *   voice:stop          → stop TTS immediately (window event)
 *   approve:pending_op  → fire workspace inbox approval
 *   deny:pending_op     → fire workspace inbox denial
 *   persona:cycle_next  → rotate to next persona/council member
 *   persona:cycle_prev  → rotate to previous persona/council member
 *   mavis:summon        → navigate to MAVIS prime chat
 *   skill:run           → invoke named skill via edge function
 *   workflow:run        → invoke named workflow
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { systemMonitor, type MonitorEvent } from "@/mavis/systemMonitor";
import { workspaceCoordinator } from "@/mavis/workspaceAgent";
import { invokeSkill } from "@/mavis/skills/_registry";

interface GestureActionPayload {
  action: string;
  skill?: string;
  input?: string;
  workflow?: string;
}

interface UseGestureActionsOptions {
  userId?: string;
  onVoiceToggle?: () => void;
  onVoiceStop?: () => void;
  onPersonaCycleNext?: () => void;
  onPersonaCyclePrev?: () => void;
}

export function useGestureActions({
  userId,
  onVoiceToggle,
  onVoiceStop,
  onPersonaCycleNext,
  onPersonaCyclePrev,
}: UseGestureActionsOptions = {}) {
  const navigate = useNavigate();
  const activeSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = systemMonitor.on("gesture:action", async (event: MonitorEvent) => {
      const p = (event.payload ?? {}) as GestureActionPayload;

      switch (p.action) {
        case "voice:toggle":
          onVoiceToggle?.();
          break;

        case "voice:stop":
          onVoiceStop?.();
          // Broadcast to any active TTS via window event for decoupled components
          window.dispatchEvent(new CustomEvent("mavis:voice:stop"));
          break;

        case "approve:pending_op": {
          if (!userId) break;
          const sessionId = activeSessionRef.current;
          if (sessionId) {
            const session = workspaceCoordinator.getSession(sessionId);
            const top = session?.pendingOps[0];
            if (session && top) await workspaceCoordinator.approvePendingOp(session, top.id);
          }
          break;
        }

        case "deny:pending_op": {
          if (!userId) break;
          const sessionId = activeSessionRef.current;
          if (sessionId) {
            const session = workspaceCoordinator.getSession(sessionId);
            const top = session?.pendingOps[0];
            if (session && top) await workspaceCoordinator.denyPendingOp(session, top.id);
          }
          break;
        }

        case "persona:cycle_next":
          onPersonaCycleNext?.();
          window.dispatchEvent(new CustomEvent("mavis:persona:cycle", { detail: { direction: "next" } }));
          break;

        case "persona:cycle_prev":
          onPersonaCyclePrev?.();
          window.dispatchEvent(new CustomEvent("mavis:persona:cycle", { detail: { direction: "prev" } }));
          break;

        case "mavis:summon":
          navigate("/chat");
          break;

        case "skill:run":
          if (userId && p.skill) {
            invokeSkill(p.skill, { userId, mode: "PRIME" }, p.input ?? "").catch(
              () => {/* non-fatal */}
            );
          }
          break;

        case "workflow:run":
          if (userId && p.workflow) {
            const sessionId = activeSessionRef.current;
            const session = sessionId ? workspaceCoordinator.getSession(sessionId) : undefined;
            if (session) {
              workspaceCoordinator
                .runWorkflow(session, p.workflow, p.input ?? "", userId)
                .catch(() => {/* non-fatal */});
            }
          }
          break;
      }
    });

    return unsub;
  }, [userId, navigate, onVoiceToggle, onVoiceStop, onPersonaCycleNext, onPersonaCyclePrev]);

  /** Expose a way to tell the hook which workspace session is active */
  function setActiveSession(sessionId: string | null) {
    activeSessionRef.current = sessionId;
  }

  return { setActiveSession };
}
