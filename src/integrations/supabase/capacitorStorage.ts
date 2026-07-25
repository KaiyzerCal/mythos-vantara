import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

// Supabase auth storage adapter (Stabilization Brief Phase 2.8). The Supabase
// client previously always used raw browser localStorage — inside the
// Capacitor Android WebView, localStorage isn't sandboxed the way native
// secure storage (Android Keystore-backed) is. On native platforms this
// backs the session with @capacitor/preferences instead; on web it falls
// back to localStorage, unchanged from before.
//
// Implements the storage interface @supabase/supabase-js expects
// (getItem/setItem/removeItem, sync or async — Supabase supports both).
const capacitorPreferencesStorage = {
  async getItem(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};

export const supabaseAuthStorage = Capacitor.isNativePlatform()
  ? capacitorPreferencesStorage
  : localStorage;
