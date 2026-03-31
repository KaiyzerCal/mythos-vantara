import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppDataProvider } from "@/contexts/AppDataContext";
import AppSidebar from "@/components/AppSidebar";
import { Loader2 } from "lucide-react";

// Pages
import { AuthPage, NotFound, SettingsPage } from "@/pages/UtilityPages";
import Dashboard from "@/pages/Dashboard";
import CharacterPage from "@/pages/CharacterPage";
import MavisChat from "@/pages/MavisChat";
import { QuestsPage, CouncilsPage, EnergyPage } from "@/pages/FeaturePages";
import { JournalPage, VaultCodexPage, SkillsPage, InventoryPage } from "@/pages/ContentPages";
import FormsPage from "@/pages/FormsPage";
import BpmPage from "@/pages/BpmPage";
import RankingsPage from "@/pages/RankingsPage";
import TowerPage from "@/pages/TowerPage";
import { AlliesPage, StorePage } from "@/pages/AlliesAndStore";
import ActivityLogPage from "@/pages/ActivityLogPage";

const queryClient = new QueryClient();

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary mx-auto mb-3" size={32} />
          <p className="text-xs font-mono text-muted-foreground">Initializing VANTARA.EXE...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return (
    <AppDataProvider>
      <div className="flex min-h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 p-5 overflow-y-auto min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/character" element={<CharacterPage />} />
            <Route path="/mavis" element={<MavisChat />} />
            <Route path="/quests" element={<QuestsPage />} />
            
            <Route path="/councils" element={<CouncilsPage />} />
            <Route path="/forms" element={<FormsPage />} />
            <Route path="/energy" element={<EnergyPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/vault" element={<VaultCodexPage />} />
            <Route path="/rankings" element={<RankingsPage />} />
            <Route path="/tower" element={<TowerPage />} />
            <Route path="/allies" element={<AlliesPage />} />
            <Route path="/bpm" element={<BpmPage />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </AppDataProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="vantara-theme">
      <Toaster />
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
