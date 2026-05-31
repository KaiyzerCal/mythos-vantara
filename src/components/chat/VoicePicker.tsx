import { useState } from "react";
import { ChevronDown, Volume2, VolumeX, Square, Loader2 } from "lucide-react";
import { VOICE_CATALOG, type VoiceGender, findVoice } from "@/lib/voiceCatalog";

interface VoicePickerProps {
  enabled: boolean;
  onToggle: () => void;
  voiceId: string;
  onVoiceChange: (voiceId: string) => void;
  isSpeaking?: boolean;
  isLoading?: boolean;
  onStop?: () => void;
}

export function VoicePicker({
  enabled,
  onToggle,
  voiceId,
  onVoiceChange,
  isSpeaking,
  isLoading,
  onStop,
}: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<VoiceGender>(findVoice(voiceId)?.gender ?? "male");
  const current = findVoice(voiceId);

  const list = VOICE_CATALOG.filter((v) => v.gender === tab);

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border transition-all ${
          enabled
            ? "text-primary border-primary/30 bg-primary/5"
            : "text-muted-foreground border-border/50"
        }`}
        title={enabled ? "Voice ON — click to mute" : "Voice OFF — click to enable"}
      >
        {enabled ? <Volume2 size={10} /> : <VolumeX size={10} />}
        {enabled ? "Voice" : "Muted"}
      </button>

      {enabled && (
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border transition-all ${
            current?.gender === "female"
              ? "text-pink-400 border-pink-400/30 bg-pink-400/5"
              : "text-blue-400 border-blue-400/30 bg-blue-400/5"
          }`}
          title="Choose voice"
        >
          <span>{current?.gender === "female" ? "♀" : "♂"} {current?.name ?? "Voice"}</span>
          <ChevronDown size={9} />
        </button>
      )}

      {isLoading && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      {isSpeaking && onStop && (
        <button
          onClick={onStop}
          className="p-1 text-destructive hover:text-destructive/80 transition-colors"
          title="Stop speaking"
        >
          <Square size={11} />
        </button>
      )}

      {open && enabled && (
        <>
          {/* click-away overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-popover shadow-xl overflow-hidden">
            <div className="flex border-b border-border">
              <button
                onClick={() => setTab("male")}
                className={`flex-1 text-[10px] font-mono py-1.5 transition-colors ${
                  tab === "male"
                    ? "text-blue-400 bg-blue-400/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ♂ Male
              </button>
              <button
                onClick={() => setTab("female")}
                className={`flex-1 text-[10px] font-mono py-1.5 transition-colors ${
                  tab === "female"
                    ? "text-pink-400 bg-pink-400/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ♀ Female
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {list.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    onVoiceChange(v.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors border-b border-border/30 last:border-b-0 ${
                    v.id === voiceId ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  <div className="font-mono font-bold">{v.name}</div>
                  <div className="text-[9px] text-muted-foreground">{v.description}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
