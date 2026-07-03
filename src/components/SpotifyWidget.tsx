import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Music2, Play, Pause, SkipForward, Volume2, VolumeX, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface NowPlaying {
  is_playing: boolean;
  track_name: string;
  artist_name: string;
  album_art?: string;
  progress_ms: number;
  duration_ms: number;
}

export function SpotifyWidget() {
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNowPlaying = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Check if Spotify is connected
      const { data: tokens } = await (supabase as any)
        .from("oauth_tokens")
        .select("provider")
        .eq("user_id", session.user.id)
        .eq("provider", "spotify")
        .single();

      if (!tokens) { setIsConnected(false); setNowPlaying(null); return; }
      setIsConnected(true);

      const { data, error } = await (supabase as any).functions.invoke("mavis-spotify-control", {
        body: { action: "now_playing" },
      });
      if (error || !data?.track_name) { setNowPlaying(null); return; }
      setNowPlaying(data as NowPlaying);
    } catch {
      // Spotify not configured — silently hide
      setIsConnected(false);
      setNowPlaying(null);
    }
  };

  const control = async (action: string, value?: number) => {
    setControlling(true);
    try {
      const { data } = await (supabase as any).functions.invoke("mavis-spotify-control", {
        body: { action, value },
      });
      if (data) setNowPlaying((prev) => prev ? { ...prev, ...data } : data);
      setTimeout(fetchNowPlaying, 800);
    } catch { /* non-critical */ } finally {
      setControlling(false);
    }
  };

  useEffect(() => {
    fetchNowPlaying();
    pollRef.current = setInterval(fetchNowPlaying, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (!isConnected || !nowPlaying) return null;

  const progress = nowPlaying.duration_ms > 0
    ? (nowPlaying.progress_ms / nowPlaying.duration_ms) * 100
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="mx-2 mb-1 rounded-lg border border-border/50 bg-card overflow-hidden"
      >
        {/* Collapsed pill */}
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20 transition-colors"
          >
            <div className={`w-1.5 h-1.5 rounded-full ${nowPlaying.is_playing ? "bg-green-400 animate-pulse" : "bg-muted-foreground"}`} />
            <Music2 size={11} className="text-green-400 shrink-0" />
            <span className="text-[10px] font-mono text-foreground/70 truncate flex-1">
              {nowPlaying.track_name}
            </span>
          </button>
        ) : (
          <div>
            {/* Progress bar */}
            <div className="h-0.5 bg-muted overflow-hidden">
              <div
                className="h-full bg-green-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="flex items-center gap-2 px-2.5 py-2">
              {nowPlaying.album_art ? (
                <img
                  src={nowPlaying.album_art}
                  alt="album art"
                  className="w-8 h-8 rounded shrink-0 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded shrink-0 bg-green-900/30 flex items-center justify-center">
                  <Music2 size={14} className="text-green-400" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-foreground/90 truncate">{nowPlaying.track_name}</p>
                <p className="text-[9px] font-mono text-muted-foreground truncate">{nowPlaying.artist_name}</p>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => control(nowPlaying.is_playing ? "pause" : "play")}
                  disabled={controlling}
                  className="w-6 h-6 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40"
                >
                  {nowPlaying.is_playing ? <Pause size={10} /> : <Play size={10} />}
                </button>
                <button
                  onClick={() => control("next")}
                  disabled={controlling}
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <SkipForward size={11} />
                </button>
                <button
                  onClick={() => setCollapsed(true)}
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown size={11} />
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
