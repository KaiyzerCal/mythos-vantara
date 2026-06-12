import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppDataProvider } from "@/contexts/AppDataContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppSidebar from "@/components/AppSidebar";
import { Loader2 } from "lucide-react";
import { useMavisNotifications } from "@/hooks/useMavisNotifications";


/** Sync the mobile browser chrome (status bar) color with the active theme.
 *  Critical for Android — Chrome reads <meta name="theme-color"> dynamically. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme === "light" ? "#ffffff" : "#0a0d1f";
    const colorScheme = resolvedTheme === "light" ? "light" : "dark";
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    document.head.appendChild(meta);

    document.documentElement.style.backgroundColor = color;
    document.documentElement.style.colorScheme = colorScheme;
    document.body.style.backgroundColor = color;
    document.body.style.colorScheme = colorScheme;
    const root = document.getElementById("root");
    if (root) {
      root.style.backgroundColor = color;
    }
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
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then(m => ({ default: m.AnalyticsPage })));
const RepurposePage = lazy(() => import("@/pages/RepurposePage").then(m => ({ default: m.RepurposePage })));
const HealthPage = lazy(() => import("@/pages/HealthPage").then(m => ({ default: m.HealthPage })));
const FinancePage = lazy(() => import("@/pages/FinancePage").then(m => ({ default: m.FinancePage })));
const SchedulerPage = lazy(() => import("@/pages/SchedulerPage").then(m => ({ default: m.SchedulerPage })));
const GoalsPage = lazy(() => import("@/pages/GoalsPage").then(m => ({ default: m.GoalsPage })));
const StudyPage = lazy(() => import("@/pages/StudyPage").then(m => ({ default: m.StudyPage })));
const TimeTrackingPage = lazy(() => import("@/pages/TimeTrackingPage").then(m => ({ default: m.TimeTrackingPage })));
const MeetingNotesPage = lazy(() => import("@/pages/MeetingNotesPage").then(m => ({ default: m.MeetingNotesPage })));
const ReadwisePage = lazy(() => import("@/pages/ReadwisePage").then(m => ({ default: m.ReadwisePage })));
const SocialAnalyticsPage = lazy(() => import("@/pages/SocialAnalyticsPage").then(m => ({ default: m.SocialAnalyticsPage })));
const EmailPage = lazy(() => import("@/pages/EmailPage").then(m => ({ default: m.EmailPage })));
const WebhookConfigPage = lazy(() => import("@/pages/WebhookConfigPage").then(m => ({ default: m.WebhookConfigPage })));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage").then(m => ({ default: m.IntegrationsPage })));
const ExportPage = lazy(() => import("@/pages/ExportPage").then(m => ({ default: m.ExportPage })));
const PlanBoard = lazy(() => import("@/pages/PlanBoard"));
const WebsiteBuilderPage = lazy(() => import("@/pages/WebsiteBuilderPage"));
const WidgetBuilderPage = lazy(() => import("@/pages/WidgetBuilderPage"));
const VideoEditorPage = lazy(() => import("@/pages/VideoEditorPage"));
const AchievementsPage = lazy(() => import("@/pages/AchievementsPage").then(m => ({ default: m.AchievementsPage })));
const ForecastPage = lazy(() => import("@/pages/ForecastPage").then(m => ({ default: m.ForecastPage })));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const StripeManagementPage = lazy(() => import("@/pages/StripeManagementPage").then(m => ({ default: m.StripeManagementPage })));
const WorkflowsPage = lazy(() => import("@/pages/WorkflowsPage").then(m => ({ default: m.WorkflowsPage })));
const AvatarStudioPage = lazy(() => import("@/pages/AvatarStudioPage").then(m => ({ default: m.AvatarStudioPage })));
const ImportPage = lazy(() => import("@/pages/ImportPage").then(m => ({ default: m.ImportPage })));
const SystemSettingsPage = lazy(() => import("@/pages/SystemSettingsPage").then(m => ({ default: m.SystemSettingsPage })));
const AgentDashboardPage = lazy(() => import("@/pages/AgentDashboardPage").then(m => ({ default: m.AgentDashboardPage })));
const MyAgents = lazy(() => import("@/pages/MyAgents"));
const WpcomCallbackPage = lazy(() => import("@/pages/WpcomCallbackPage"));
const PhoneCallsPage = lazy(() => import("@/pages/PhoneCallsPage"));
const SMSPage = lazy(() => import("@/pages/SMSPage"));
const ApiKeysPage = lazy(() => import("@/pages/ApiKeysPage"));
const LeadGenPage = lazy(() => import("@/pages/LeadGenPage"));
const CompetitorIntelPage = lazy(() => import("@/pages/CompetitorIntelPage"));
const ReceptionistPage = lazy(() => import("@/pages/ReceptionistPage"));
const PlaybooksPage = lazy(() => import("@/pages/PlaybooksPage").then(m => ({ default: m.PlaybooksPage })));
const StandingOrderTemplatesPage = lazy(() => import("@/pages/StandingOrderTemplatesPage").then(m => ({ default: m.StandingOrderTemplatesPage })));
const SystemHealthPage = lazy(() => import("@/pages/SystemHealthPage").then(m => ({ default: m.SystemHealthPage })));
const BehavioralModelPage = lazy(() => import("@/pages/BehavioralModelPage").then(m => ({ default: m.BehavioralModelPage })));
const RSSReaderPage = lazy(() => import("@/pages/RSSReaderPage").then(m => ({ default: m.RSSReaderPage })));
// Public demo — no auth required
const MavisDemo = lazy(() => import("@/pages/MavisDemo"));
const IntelligencePage = lazy(() => import("@/pages/IntelligencePage"));
const DesignStudio = lazy(() => import("@/pages/DesignStudio"));

const queryClient = new QueryClient();

const Spinner = (
  <div className="flex items-center justify-center h-full min-h-screen">
    <Loader2 className="animate-spin text-primary" size={24} />
  </div>
);

function AppContent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  useMavisNotifications();


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
      <div className="flex min-h-screen bg-background">
        <AppSidebar />
        
        <main className={`flex-1 min-w-0 ${["/mavis-ui", "/demo"].includes(location.pathname) ? "overflow-hidden" : "p-5 overflow-y-auto"}`}>
          <Suspense fallback={Spinner}>
            <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/character" element={<CharacterPage />} />
              <Route path="/mavis-ui" element={<MavisDemo />} />
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
              <Route path="/plans" element={<PlanBoard />} />
              <Route path="/websites" element={<WebsiteBuilderPage />} />
              <Route path="/widgets" element={<WidgetBuilderPage />} />
              <Route path="/achievements" element={<AchievementsPage />} />
              <Route path="/forecast" element={<ForecastPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/stripe" element={<StripeManagementPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/creator" element={<VideoEditorPage />} />
              <Route path="/avatar-studio" element={<AvatarStudioPage />} />
              <Route path="/system-settings" element={<SystemSettingsPage />} />
              <Route path="/agents" element={<AgentDashboardPage />} />
              <Route path="/my-agents" element={<MyAgents />} />
              <Route path="/intelligence" element={<IntelligencePage />} />
              <Route path="/design-studio" element={<DesignStudio />} />
              <Route path="/wpcom-callback" element={<WpcomCallbackPage />} />
              <Route path="/phone" element={<PhoneCallsPage />} />
              <Route path="/receptionist" element={<ReceptionistPage />} />
              <Route path="/sms" element={<SMSPage />} />
              <Route path="/api-keys" element={<ApiKeysPage />} />
              <Route path="/leads" element={<LeadGenPage />} />
              <Route path="/competitors" element={<CompetitorIntelPage />} />
              <Route path="/playbooks" element={<PlaybooksPage />} />
              <Route path="/so-templates" element={<StandingOrderTemplatesPage />} />
              <Route path="/system-health" element={<SystemHealthPage />} />
              <Route path="/behavioral-model" element={<BehavioralModelPage />} />
              <Route path="/rss-feeds" element={<RSSReaderPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </ErrorBoundary>
          </Suspense>
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
