/**
 * MAVIS Plugin System — adapted from ElizaOS plugin architecture.
 * Plugins declare Actions (executable), Providers (context injectors),
 * Evaluators (output assessors), and Services (long-running background tasks).
 */

import { supabase } from "@/integrations/supabase/client";

// ── Core context passed to every handler ────────────────────────────────────

export interface PluginContext {
  userId: string;
  agentId: string;
  agentName: string;
  agentType: "council" | "persona" | "plugin" | "mavis";
  mode: string;
  messages: Array<{ role: string; content: string }>;
  appData?: Record<string, unknown>;
}

// ── Action ───────────────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export interface MavisAction {
  name: string;
  similes: string[];       // Alternative names the LLM might output
  description: string;
  validate: (ctx: PluginContext, input: string) => Promise<boolean>;
  handler: (ctx: PluginContext, input: string) => Promise<ActionResult>;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface MavisProvider {
  name: string;
  description: string;
  get: (ctx: PluginContext) => Promise<string>;
}

// ── Evaluator ────────────────────────────────────────────────────────────────

export interface EvaluatorResult {
  score: number;          // 0-1
  feedback?: string;
  memoryWorthy: boolean;  // Should this output be stored as a memory?
}

export interface MavisEvaluator {
  name: string;
  alwaysRun?: boolean;
  validate: (ctx: PluginContext, output: string) => Promise<boolean>;
  handler: (ctx: PluginContext, output: string) => Promise<EvaluatorResult>;
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface MavisService {
  name: string;
  description: string;
  start: (ctx: PluginContext) => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

// ── Plugin manifest ──────────────────────────────────────────────────────────

export interface MavisPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];
  requiredScopes: string[];
  actions?: MavisAction[];
  providers?: MavisProvider[];
  evaluators?: MavisEvaluator[];
  services?: MavisService[];
  onInit?: (ctx: PluginContext) => Promise<void>;
  onEnable?: (config: Record<string, unknown>) => Promise<void>;
  onDisable?: () => Promise<void>;
}

// ── Registry ─────────────────────────────────────────────────────────────────

class PluginRegistry {
  private plugins = new Map<string, MavisPlugin>();
  private runningServices = new Map<string, MavisService>();

  register(plugin: MavisPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  unregister(name: string): void {
    this.plugins.delete(name);
  }

  getPlugin(name: string): MavisPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): MavisPlugin[] {
    return [...this.plugins.values()];
  }

  getEnabledPlugins(userId: string): Promise<MavisPlugin[]> {
    return supabase
      .from("mavis_plugins")
      .select("name, enabled, config")
      .eq("user_id", userId)
      .eq("enabled", true)
      .then(({ data }) => {
        if (!data) return [];
        return data
          .map(row => this.plugins.get(row.name))
          .filter((p): p is MavisPlugin => !!p);
      });
  }

  // ── Action resolution (ElizaOS fuzzy matching) ─────────────────────────

  resolveAction(rawName: string): MavisAction | null {
    const normalized = rawName.trim().toUpperCase().replace(/\s+/g, "_");
    for (const plugin of this.plugins.values()) {
      for (const action of plugin.actions ?? []) {
        const names = [action.name, ...action.similes].map(n =>
          n.toUpperCase().replace(/\s+/g, "_")
        );
        if (names.includes(normalized)) return action;
      }
    }
    return null;
  }

  async invokeAction(
    actionName: string,
    ctx: PluginContext,
    input: string
  ): Promise<ActionResult> {
    const action = this.resolveAction(actionName);
    if (!action) {
      return { success: false, output: "", error: `Unknown action: ${actionName}` };
    }

    const valid = await action.validate(ctx, input);
    if (!valid) {
      return { success: false, output: "", error: `Validation failed for action: ${actionName}` };
    }

    const result = await action.handler(ctx, input);

    // Log execution to audit trail
    await supabase.from("mavis_plugin_executions").insert({
      user_id: ctx.userId,
      plugin_name: this._findPluginForAction(actionName)?.name ?? "unknown",
      action_name: actionName,
      input,
      output: result.output,
      success: result.success,
      error_msg: result.error ?? null,
    }).throwOnError().catch(() => {/* non-fatal */});

    return result;
  }

  // ── Provider pipeline ──────────────────────────────────────────────────

  async runProviders(ctx: PluginContext): Promise<string> {
    const sections: string[] = [];
    for (const plugin of this.plugins.values()) {
      for (const provider of plugin.providers ?? []) {
        try {
          const text = await provider.get(ctx);
          if (text.trim()) sections.push(`[${provider.name}]\n${text}`);
        } catch {/* non-fatal provider failure */}
      }
    }
    return sections.join("\n\n");
  }

  // ── Evaluator pipeline ─────────────────────────────────────────────────

  async runEvaluators(
    ctx: PluginContext,
    output: string
  ): Promise<EvaluatorResult[]> {
    const results: EvaluatorResult[] = [];
    for (const plugin of this.plugins.values()) {
      for (const evaluator of plugin.evaluators ?? []) {
        try {
          const shouldRun = evaluator.alwaysRun || await evaluator.validate(ctx, output);
          if (shouldRun) {
            results.push(await evaluator.handler(ctx, output));
          }
        } catch {/* non-fatal */}
      }
    }
    return results;
  }

  // ── Service lifecycle ──────────────────────────────────────────────────

  async startService(pluginName: string, serviceName: string, ctx: PluginContext): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    const service = plugin?.services?.find(s => s.name === serviceName);
    if (!service || service.isRunning()) return;
    await service.start(ctx);
    this.runningServices.set(`${pluginName}:${serviceName}`, service);
  }

  async stopService(pluginName: string, serviceName: string): Promise<void> {
    const key = `${pluginName}:${serviceName}`;
    const service = this.runningServices.get(key);
    if (!service) return;
    await service.stop();
    this.runningServices.delete(key);
  }

  // ── DB sync ────────────────────────────────────────────────────────────

  async syncToDb(plugin: MavisPlugin, userId: string): Promise<void> {
    await supabase.from("mavis_plugins").upsert({
      user_id: userId,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author ?? null,
      manifest: {
        actions: plugin.actions?.map(a => ({ name: a.name, similes: a.similes, description: a.description })) ?? [],
        providers: plugin.providers?.map(p => ({ name: p.name, description: p.description })) ?? [],
        evaluators: plugin.evaluators?.map(e => ({ name: e.name })) ?? [],
        services: plugin.services?.map(s => ({ name: s.name, description: s.description })) ?? [],
      },
      capabilities: plugin.capabilities,
      required_scopes: plugin.requiredScopes,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,name" });
  }

  private _findPluginForAction(actionName: string): MavisPlugin | null {
    const normalized = actionName.toUpperCase().replace(/\s+/g, "_");
    for (const plugin of this.plugins.values()) {
      for (const action of plugin.actions ?? []) {
        const names = [action.name, ...action.similes].map(n => n.toUpperCase().replace(/\s+/g, "_"));
        if (names.includes(normalized)) return plugin;
      }
    }
    return null;
  }
}

export const pluginRegistry = new PluginRegistry();
