// Persistent global voice context — keeps the MAVIS Realtime voice session alive
// across page navigation. VoiceProvider renders MavisRealtimeVoice as a root-level
// overlay so the WebRTC connection isn't torn down when routes change.
// Ctrl+Shift+V (or the floating mic button) toggles it from anywhere in the app.

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { MavisRealtimeVoice } from "@/components/MavisRealtimeVoice";

interface VoiceContextValue {
  isOpen:      boolean;
  openVoice:   (context?: string) => void;
  closeVoice:  () => void;
  toggleVoice: (context?: string) => void;
}

const VoiceContext = createContext<VoiceContextValue>({
  isOpen:      false,
  openVoice:   () => {},
  closeVoice:  () => {},
  toggleVoice: () => {},
});

export function useVoice() {
  return useContext(VoiceContext);
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen]       = useState(false);
  const [context, setContext]     = useState<string | undefined>(undefined);
  const contextRef = useRef<string | undefined>(undefined);

  const openVoice = useCallback((ctx?: string) => {
    contextRef.current = ctx;
    setContext(ctx);
    setIsOpen(true);
  }, []);

  const closeVoice = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleVoice = useCallback((ctx?: string) => {
    setIsOpen(prev => {
      if (!prev) {
        contextRef.current = ctx;
        setContext(ctx);
      }
      return !prev;
    });
  }, []);

  return (
    <VoiceContext.Provider value={{ isOpen, openVoice, closeVoice, toggleVoice }}>
      {children}
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <MavisRealtimeVoice onClose={closeVoice} context={context} />
        </div>
      )}
    </VoiceContext.Provider>
  );
}
