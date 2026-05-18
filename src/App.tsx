import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppDataProvider } from "@/contexts/AppDataContext";
import AppSidebar from "@/components/AppSidebar";
import { Loader2 } from "lucide-react";

/** Sync the mobile browser chrome (status bar) color with the active theme.
 *  Critical for Android — Chrome reads <meta name="theme-color"> dynamically. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme === "light" ? "#ffffff" : "#0a0d1f";
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.appendChild(meta);
  }, [resolvedTheme]);
  return null;
}

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
import ScouterPage from "@/pages/ScouterPage";
import ActivityLogPage from "@/pages/ActivityLogPage";
import PersonasPage from "@/pages/PersonasPage";
import PersonaRelationshipsPage from "@/pages/PersonaRelationshipsPage";
import Inbox from "@/pages/Inbox";
import CouncilBoard from "@/pages/CouncilBoard";
import KnowledgeGraph from "@/pages/KnowledgeGraph";
import { ContactsPage } from "@/pages/ContactsPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { RepurposePage } from "@/pages/RepurposePage";
import { HealthPage } from "@/pages/HealthPage";
import { FinancePage } from "@/pages/FinancePage";
import { SchedulerPage } from "@/pages/SchedulerPage";
import { GoalsPage } from "@/pages/GoalsPage";
import { StudyPage } from "@/pages/StudyPage";
import { TimeTrackingPage } from "@/pages/TimeTrackingPage";
import { MeetingNotesPage } from "@/pages/MeetingNotesPage";
import { ReadwisePage } from "@/pages/ReadwisePage";
import { SocialAnalyticsPage } from "@/pages/SocialAnalyticsPage";
import { EmailPage } from "@/pages/EmailPage";
import { WebhookConfigPage } from "@/pages/WebhookConfigPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { ExportPage } from "@/pages/ExportPage";
import { ForecastPage } from "@/pages/ForecastPage";
import { ImportPage } from "@/pages/ImportPage";
import { StripeManagementPage } from "@/pages/StripeManagementPage";
import { AchievementsPage } from "@/pages/AchievementsPage";

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
            <Route path="/scouter" element={<ScouterPage />} />
            <Route path="/bpm" element={<BpmPage />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/personas" element={<PersonasPage />} />
            <Route path="/persona-relationships" element={<PersonaRelationshipsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/council-board" element={<CouncilBoard />} />
            <Route path="/knowledge" element={<KnowledgeGraph />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/repurpose" element={<RepurposePage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/scheduler" element={<SchedulerPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/study" element={<StudyPage />} />
            <Route path="/time" element={<TimeTrackingPage />} />
            <Route path="/meetings" element={<MeetingNotesPage />} />
            <Route path="/highlights" element={<ReadwisePage />} />
            <Route path="/social-analytics" element={<SocialAnalyticsPage />} />
            <Route path="/email" element={<EmailPage />} />
            <Route path="/webhooks" element={<WebhookConfigPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/forecast" element={<ForecastPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/stripe" element={<StripeManagementPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
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
      <ThemeColorSync />
      <Toaster />
      <SonnerToaster position="bottom-right" theme="dark" />
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
