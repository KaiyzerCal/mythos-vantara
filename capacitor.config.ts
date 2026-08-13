import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vantara.exe',
  appName: 'VANTARA.EXE',
  webDir: 'dist',
  backgroundColor: '#ffffff',
  android: {
    backgroundColor: '#ffffff',
  },
  plugins: {
    // Self-hosted OTA (src/lib/liveUpdate.ts + Supabase Storage
    // 'ota-bundles' bucket) — no Capawesome Cloud account, no
    // subscription. appId here is just this plugin's own internal
    // namespace, unrelated to the Capacitor appId above.
    LiveUpdate: {
      appId: 'vantara-exe-ota',
      autoDeleteBundles: true,
      autoBlockRolledBackBundles: true,
      readyTimeout: 10000,
    },
  },
};

export default config;
