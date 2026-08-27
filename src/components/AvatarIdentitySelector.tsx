// Which brand identity a production is made under.
//
// The two built-in identities are presets, not rows: picking one does not write
// anything until the operator saves, so a first-time selection costs nothing and
// a production can run under an identity that was never forged into a persona.
//
// Selecting is deliberately separate from configuring. The toggle sets the
// identity; the fields below it edit that identity's stored configuration, and
// only appear once there is a persona row to edit — otherwise the operator is
// filling in a form that saves to nowhere.
import { useState } from "react";
import { Cpu, Activity, Check, Loader2 } from "lucide-react";
import {
  IDENTITIES, OVERLAY_LABELS, RENDERING_LABELS, OVERLAY_STYLES,
  type AvatarIdentity, type OverlayStyle,
} from "@/lib/avatarIdentity";

const ICONS: Record<string, typeof Cpu> = {
  avatar_skyforge_real: Cpu,
  avatar_bioneer_animated: Activity,
};

export interface AvatarIdentitySelectorProps {
  /** Currently selected identity key, or null for none. */
  value: string | null;
  onChange: (key: string | null) => void;
  /** Overlay override for the selected identity, when it has been forged. */
  overlayStyle?: OverlayStyle;
  onOverlayChange?: (o: OverlayStyle) => void;
  /** Shown only when the identity exists as a persona row. */
  canConfigure?: boolean;
  saving?: boolean;
  onSave?: () => void;
}

export function AvatarIdentitySelector({
  value, onChange, overlayStyle, onOverlayChange, canConfigure = false, saving = false, onSave,
}: AvatarIdentitySelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const selected = IDENTITIES.find((i) => i.key === value) ?? null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {IDENTITIES.map((identity: AvatarIdentity) => {
          const Icon = ICONS[identity.key] ?? Cpu;
          const active = value === identity.key;
          return (
            <button
              key={identity.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                // Re-pressing the active identity clears it, which is how the
                // operator gets back to "let the brief decide".
                onChange(active ? null : identity.key);
                setExpanded(false);
              }}
              className={`text-left rounded border p-3 transition-colors ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-medium">{identity.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  {identity.mode}
                </span>
                {active && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{identity.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {RENDERING_LABELS[identity.rendering_style]}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {OVERLAY_LABELS[identity.overlay_style]}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {!selected && (
        <p className="text-xs text-muted-foreground">
          No identity selected — MAVIS will pick one only when the brief is clearly
          technical or clearly fitness, and otherwise stay neutral.
        </p>
      )}

      {selected && canConfigure && (
        <div className="rounded border border-border p-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            {expanded ? "Hide" : "Configure"} {selected.name}
          </button>

          {expanded && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-muted-foreground" htmlFor="overlay-style">
                On-screen overlays
              </label>
              <select
                id="overlay-style"
                value={overlayStyle ?? selected.overlay_style}
                onChange={(e) => onOverlayChange?.(e.target.value as OverlayStyle)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                {OVERLAY_STYLES.map((o) => (
                  <option key={o} value={o}>{OVERLAY_LABELS[o]}</option>
                ))}
              </select>
              {onSave && (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  Save identity
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
