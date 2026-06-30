import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppDataProvider } from "@/contexts/AppDataContext";
import { VoiceProvider, useVoice } from "@/contexts/VoiceContext";
import AppSidebar from "@/components/AppSidebar";
import { Loader2 } from "lucide-react";
import { useMavisNotifications } from "@/hooks/useMavisNotifications";


/** Sync browser chrome color + ensure <html> has the correct class on every theme change. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const isDark = resolvedTheme !== "light";
    const color = isDark ? "#0a0d1f" : "#f5f5f7";
    // Update theme-color metas (media-query specific ones in index.html)
    const darkMeta = document.querySelector('meta[name="theme-color"][media*="dark"]') as HTMLMetaElement | null;
    const lightMeta = document.querySelector('meta[name="theme-color"][media*="light"]') as HTMLMetaElement | null;
    if (darkMeta) darkMeta.content = isDark ? color : "#0a0d1f";
    if (lightMeta) lightMeta.content = isDark ? "#ffffff" : color;
    // Belt-and-suspenders: ensure html class is in sync (next-themes handles this, but needed for Android WebView)
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
  }, [resolvedTheme]);
  return null;
}

// Pages — lazy-loaded for code splitting
const AuthPage = lazy(() => import("@/pages/UtilityPages").then(m => ({ default: m.AuthPage })));
const NotFound = lazy(() => import("@/pages/UtilityPages").then(m => ({ default: m.NotFound })));
const SettingsPage = lazy(() => import("@/pages/UtilityPages").then(m => ({ default: m.SettingsPage })));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const CharacterPage = lazy(() => import("@/pages/CharacterPage"));
const MavisChat = lazy(() => import("@/pages/MavisChat"));
const QuestsPage = lazy(() => import("@/pages/FeaturePages").then(m => ({ default: m.QuestsPage })));
const CouncilsPage = lazy(() => import("@/pages/FeaturePages").then(m => ({ default: m.CouncilsPage })));
const EnergyPage = lazy(() => import("@/pages/FeaturePages").then(m => ({ default: m.EnergyPage })));
const JournalPage = lazy(() => import("@/pages/ContentPages").then(m => ({ default: m.JournalPage })));
const VaultCodexPage = lazy(() => import("@/pages/ContentPages").then(m => ({ default: m.VaultCodexPage })));
const SkillsPage = lazy(() => import("@/pages/ContentPages").then(m => ({ default: m.SkillsPage })));
const InventoryPage = lazy(() => import("@/pages/ContentPages").then(m => ({ default: m.InventoryPage })));
const DomainPage = lazy(() => import("@/pages/ContentPages").then(m => ({ default: m.DomainPage })));
const FormsPage = lazy(() => import("@/pages/FormsPage"));
const BpmPage = lazy(() => import("@/pages/BpmPage"));
const RankingsPage = lazy(() => import("@/pages/RankingsPage"));
const TowerPage = lazy(() => import("@/pages/TowerPage"));
const AlliesPage = lazy(() => import("@/pages/AlliesAndStore").then(m => ({ default: m.AlliesPage })));
const StorePage = lazy(() => import("@/pages/AlliesAndStore").then(m => ({ default: m.StorePage })));
const ScouterPage = lazy(() => import("@/pages/ScouterPage"));
const ActivityLogPage = lazy(() => import("@/pages/ActivityLogPage"));
const PersonasPage = lazy(() => import("@/pages/PersonasPage"));
const PersonaRelationshipsPage = lazy(() => import("@/pages/PersonaRelationshipsPage"));
const Inbox = lazy(() => import("@/pages/Inbox"));
const CouncilBoard = lazy(() => import("@/pages/CouncilBoard"));
const KnowledgeGraph = lazy(() => import("@/pages/KnowledgeGraph"));
const ContactsPage = lazy(() => import("@/pages/ContactsPage").then(m => ({ default: m.ContactsPage })));
const IntelligencePage = lazy(() => import("@/pages/IntelligencePage"));
const PhoneCallsPage = lazy(() => import("@/pages/PhoneCallsPage"));
const ReceptionistPage = lazy(() => import("@/pages/ReceptionistPage"));
const SMSPage = lazy(() => import("@/pages/SMSPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then(m => ({ default: m.AnalyticsPage })));
const RepurposePage = lazy(() => import("@/pages/RepurposePage").then(m => ({ default: m.RepurposePage })));
const HealthPage = lazy(() => import("@/pages/HealthPage").then(m => ({ default: m.HealthPage })));
const FinancePage = lazy(() => import("@/pages/FinancePage").then(m => ({ default: m.FinancePage })));
const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then(m => ({ default: m.SchedulerPage })));
const GoalsPage = lazy(() => import("@/pages/GoalsPage").then(m => ({ default: m.GoalsPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage"));
const PlaybooksPage = lazy(() => import("@/pages/PlaybooksPage").then(m => ({ default: m.PlaybooksPage })));
const StandingOrderTemplatesPage = lazy(() => import("@/pages/StandingOrderTemplatesPage").then(m => ({ default: m.StandingOrderTemplatesPage })));
const StudyPage = lazy(() => import("@/pages/StudyPage").then(m => ({ default: m.StudyPage })));
const TimeTrackingPage = lazy(() => import("@/pages/TimeTrackingPage").then(m => ({ default: m.TimeTrackingPage })));
const MeetingNotesPage = lazy(() => import("@/pages/MeetingNotesPage").then(m => ({ default: m.MeetingNotesPage })));
const ReadwisePage = lazy(() => import("@/pages/ReadwisePage").then(m => ({ default: m.ReadwisePage })));
const SocialAnalyticsPage = lazy(() => import("@/pages/SocialAnalyticsPage").then(m => ({ default: m.SocialAnalyticsPage })));
const EmailPage = lazy(() => import("@/pages/EmailPage").then(m => ({ default: m.EmailPage })));
const LeadGenPage = lazy(() => import("@/pages/LeadGenPage"));
const CompetitorIntelPage = lazy(() => import("@/pages/CompetitorIntelPage"));
const ApiKeysPage = lazy(() => import("@/pages/ApiKeysPage"));
const WebhookConfigPage = lazy(() => import("@/pages/WebhookConfigPage").then(m => ({ default: m.WebhookConfigPage })));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage").then(m => ({ default: m.IntegrationsPage })));
const ExportPage = lazy(() => import("@/pages/ExportPage").then(m => ({ default: m.ExportPage })));
const PlanBoard = lazy(() => import("@/pages/PlanBoard"));
const WebsiteBuilderPage = lazy(() => import("@/pages/WebsiteBuilderPage"));
const WidgetBuilderPage = lazy(() => import("@/pages/WidgetBuilderPage"));
const VideoEditorPage = lazy(() => import("@/pages/VideoEditorPage"));
const AvatarStudioPage = lazy(() => import("@/pages/AvatarStudioPage").then(m => ({ default: m.AvatarStudioPage })));
const ProductionIntelligence = lazy(() => import("@/pages/ProductionIntelligence"));
const DesignStudio = lazy(() => import("@/pages/DesignStudio"));
const AchievementsPage = lazy(() => import("@/pages/AchievementsPage").then(m => ({ default: m.AchievementsPage })));
const ForecastPage = lazy(() => import("@/pages/ForecastPage").then(m => ({ default: m.ForecastPage })));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const StripeManagementPage = lazy(() => import("@/pages/StripeManagementPage").then(m => ({ default: m.StripeManagementPage })));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage").then(m => ({ default: m.WorkflowsPage })));
const ImportPage = lazy(() => import("@/pages/ImportPage").then(m => ({ default: m.ImportPage })));
const AgentDashboardPage = lazy(() => import("@/pages/AgentDashboardPage").then(m => ({ default: m.AgentDashboardPage })));
const SystemSettingsPage = lazy(() => import("@/pages/SystemSettingsPage").then(m => ({ default: m.SystemSettingsPage })));
const FactoryPage = lazy(() => import("@/pages/FactoryPage"));
// Public demo — no auth required
const MavisDemo = lazy(() => import("@/pages/MavisDemo"));

const queryClient = new QueryClient();

const Spinner = (
  <div className="flex items-center justify-center h-full min-h-screen">
    <Loader2 className="animate-spin text-primary" size={24} />
  </div>
);

function AppContent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { toggleVoice } = useVoice();
  useMavisNotifications();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        toggleVoice();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleVoice]);


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

  if (!user) return (
    <Suspense fallback={Spinner}>
      <AuthPage />
    </Suspense>
  );

  return (
    <AppDataProvider>
      <VoiceProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        <AppSidebar />

        <main className={`flex-1 min-w-0 h-full ${["/mavis-ui", "/demo", "/factory"].includes(location.pathname) ? "overflow-hidden" : "overflow-y-auto p-5"}`}>
          <Suspense fallback={Spinner}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/index" element={<Dashboard />} />
              <Route path="/character" element={<CharacterPage />} />
              <Route path="/mavis-ui" element={<MavisDemo />} />
              <Route path="/demo" element={<MavisDemo />} />
              <Route path="/mavis" element={<MavisChat />} />
              <Route path="/quests" element={<QuestsPage />} />

              <Route path="/councils" element={<CouncilsPage />} />
              <Route path="/forms" element={<FormsPage />} />
              <Route path="/energy" element={<EnergyPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/domain" element={<DomainPage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/vault" element={<VaultCodexPage />} />
              <Route path="/rankings" element={<RankingsPage />} />
              <Route path="/tower" element={<TowerPage />} />
              <Route path="/allies" element={<AlliesPage />} />
              <Route path="/scouter" element={<ScouterPage />} />
              <Route path="/factory" element={<FactoryPage />} />
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
              <Route path="/intelligence" element={<IntelligencePage />} />
              <Route path="/phone" element={<PhoneCallsPage />} />
              <Route path="/receptionist" element={<ReceptionistPage />} />
              <Route path="/sms" element={<SMSPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/repurpose" element={<RepurposePage />} />
              <Route path="/health" element={<HealthPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/scheduler" element={<SchedulerPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/playbooks" element={<PlaybooksPage />} />
              <Route path="/so-templates" element={<StandingOrderTemplatesPage />} />
              <Route path="/study" element={<StudyPage />} />
              <Route path="/time" element={<TimeTrackingPage />} />
              <Route path="/meetings" element={<MeetingNotesPage />} />
              <Route path="/highlights" element={<ReadwisePage />} />
              <Route path="/social-analytics" element={<SocialAnalyticsPage />} />
              <Route path="/email" element={<EmailPage />} />
              <Route path="/leads" element={<LeadGenPage />} />
              <Route path="/competitors" element={<CompetitorIntelPage />} />
              <Route path="/api-keys" element={<ApiKeysPage />} />
              <Route path="/webhooks" element={<WebhookConfigPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/plans" element={<PlanBoard />} />
              <Route path="/websites" element={<WebsiteBuilderPage />} />
              <Route path="/widgets" element={<WidgetBuilderPage />} />
              <Route path="/avatar-studio" element={<AvatarStudioPage />} />
              <Route path="/production-intel" element={<ProductionIntelligence />} />
              <Route path="/design-studio" element={<DesignStudio />} />
              <Route path="/achievements" element={<AchievementsPage />} />
              <Route path="/forecast" element={<ForecastPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/stripe" element={<StripeManagementPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/creator" element={<VideoEditorPage />} />
              <Route path="/agents" element={<AgentDashboardPage />} />
              <Route path="/system-settings" element={<SystemSettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      </VoiceProvider>
    </AppDataProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="vantara-theme">
      <TooltipProvider>
        <ThemeColorSync />
        <Toaster />
        <SonnerToaster position="bottom-right" theme="dark" />
        <BrowserRouter>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
