// Which parts of the app an executed MAVIS action actually changed.
//
// Background. Every refresh site in MavisChat used to call refetchAll() — all
// seventeen data hooks — because the client had no idea what an action touched.
// That was tolerable only because realtime was inert (see migration
// 20260822140000): refetchAll was the app's whole refresh mechanism, so
// over-fetching was the safe default.
//
// With realtime publishing, refetchAll is a backstop rather than the primary
// path, and its cost is no longer justified: asking MAVIS to search the web
// currently triggers seventeen queries for a read that wrote nothing.
//
// The risk posture here is deliberately one-directional. An action absent from
// SECTION_FOR falls back to "all", which is exactly today's behaviour — so a
// type nobody mapped, a new action added next month, or anything whose blast
// radius isn't obvious (run_code, the Composio and Salesforce bridges, the
// third-party agent handlers) keeps the old full refresh. This map can only
// narrow refreshes it is sure about; it can never make one too small by
// omission. Adding a WRONG entry is the only way to break it, which is what
// refreshContract.test.ts guards.

import { normalizeActionType } from "./actionExecutor";

/**
 * The refetchable units of AppDataContext. One per refetch function wired into
 * refetchAll — keep in step with the map in AppDataProvider.refreshSections.
 */
export const SECTIONS = [
  "profile", "quests", "tasks", "journal", "vault", "councils", "skills",
  "energy", "inventory", "allies", "bpm", "store", "currencies",
  "transformations", "rankings", "rituals", "domainEffects",
] as const;

export type Section = (typeof SECTIONS)[number];

/** Refresh everything — the fallback whenever an action's reach is unknown. */
export const ALL = "all" as const;

export type RefreshTarget = Section[] | typeof ALL;

/**
 * Canonical action type → the sections it writes to.
 *
 * An empty array means "this action succeeded but wrote nothing" — reads,
 * lookups and status polls. Those skip the refresh entirely rather than
 * falling back to it.
 *
 * Only actions whose reach is unambiguous appear here. Everything else is
 * intentionally absent so it resolves to ALL; see the header.
 */
export const SECTION_FOR: Readonly<Record<string, readonly Section[]>> = {
  // ── Quests ────────────────────────────────────────────────────────────
  create_quest: ["quests"],
  update_quest: ["quests"],
  complete_quest: ["quests"],
  delete_quest: ["quests"],

  // No task entries, deliberately. Every task action is an alias for its
  // quest equivalent on both sides — and mavis-actions' surviving
  // `case "create_task"` inserts into the QUESTS table, not tasks. Mapping
  // them to ["tasks"] would refresh the one section the write never touched.
  // The "tasks" section stays in SECTIONS because refreshSections is a
  // general API, but no MAVIS action reaches it.

  // ── Skills ────────────────────────────────────────────────────────────
  create_skill: ["skills"],
  update_skill: ["skills"],
  delete_skill: ["skills"],
  create_subskill: ["skills"],

  // ── Journal ───────────────────────────────────────────────────────────
  create_journal: ["journal"],
  update_journal: ["journal"],
  delete_journal: ["journal"],

  // ── Vault ─────────────────────────────────────────────────────────────
  create_vault: ["vault"],
  update_vault: ["vault"],
  delete_vault: ["vault"],

  // ── Council ───────────────────────────────────────────────────────────
  create_council_member: ["councils"],
  update_council_member: ["councils"],
  delete_council_member: ["councils"],

  // ── Energy ────────────────────────────────────────────────────────────
  create_energy_system: ["energy"],
  update_energy: ["energy"],
  delete_energy: ["energy"],

  // ── Inventory ─────────────────────────────────────────────────────────
  create_inventory_item: ["inventory"],
  update_inventory_item: ["inventory"],
  delete_inventory_item: ["inventory"],

  // ── Allies ────────────────────────────────────────────────────────────
  create_ally: ["allies"],
  update_ally: ["allies"],
  delete_ally: ["allies"],

  // ── Store ─────────────────────────────────────────────────────────────
  // Buying an item spends a currency, so the balance moves with the shelf.
  create_store_item: ["store"],
  update_store_item: ["store"],
  delete_store_item: ["store", "currencies"],

  // ── Transformations (Forms) ───────────────────────────────────────────
  create_transformation: ["transformations"],
  update_transformation: ["transformations"],
  delete_transformation: ["transformations"],

  // ── Rankings ──────────────────────────────────────────────────────────
  create_ranking: ["rankings"],
  update_ranking: ["rankings"],
  delete_ranking: ["rankings"],
  add_to_rankings: ["rankings"],

  // ── Rituals ───────────────────────────────────────────────────────────
  create_ritual: ["rituals"],
  delete_ritual: ["rituals"],

  // ── Domain effects ────────────────────────────────────────────────────
  create_domain_effect: ["domainEffects"],
  update_domain_effect: ["domainEffects"],
  delete_domain_effect: ["domainEffects"],

  // ── Biometrics ────────────────────────────────────────────────────────
  log_bpm_session: ["bpm"],

  // ── Character sheet ───────────────────────────────────────────────────
  update_profile: ["profile"],
  award_xp: ["profile"],

  // ── Reads: succeeded, wrote nothing ───────────────────────────────────
  // These are the actions that made a full refetchAll most obviously wasteful.
  // Anything that merely *looks* read-only but reaches a third party that
  // could write back is deliberately NOT here.
  search_web: [],
  browse_url: [],
  browse_page: [],
  get_market_data: [],
  stock_analysis: [],
  recall_memory: [],
  list_skills: [],
  list_gestures: [],
  get_identity: [],
  get_biometric_state: [],
  get_standing_orders: [],
  get_pending_reviews: [],
  ruview_get_all: [],
  ruview_get_presence: [],
  ruview_get_vitals: [],
  salesforce_query: [],
  salesforce_search: [],
  salesforce_get_record: [],
  salesforce_get_crm_context: [],
  booking_list: [],
  booking_find_venue: [],
  video_status: [],
  social_list_personas: [],
  social_list_posts: [],
  social_get_persona: [],
};

/**
 * Where to send the operator to see the result of an action.
 *
 * Consumed as an offer, not an order — MavisChat surfaces it as a link on the
 * action-status chip rather than navigating on its own. Yanking someone out of
 * a conversation they are still having is worse than making them tap once.
 * Every value must be a real route in App.tsx; routeContract drift is tested.
 */
export const ROUTE_FOR: Readonly<Record<string, string>> = {
  create_quest: "/quests",
  complete_quest: "/quests",
  create_skill: "/skills",
  create_subskill: "/skills",
  create_journal: "/journal",
  create_vault: "/vault",
  create_council_member: "/councils",
  create_energy_system: "/energy",
  create_inventory_item: "/inventory",
  create_ally: "/allies",
  create_store_item: "/store",
  create_transformation: "/forms",
  create_ranking: "/rankings",
  create_ritual: "/quests",
  create_domain_effect: "/domain",
  log_bpm_session: "/bpm",
  update_profile: "/character",
  award_xp: "/character",
  create_website: "/websites",
  create_widget: "/widgets",
  create_persona: "/personas",
  forge_persona: "/personas",
  create_image: "/gallery",
  generate_image: "/gallery",
  image_gen: "/gallery",
  generate_video: "/gallery",
  avatar_video: "/avatar-studio",
};

/**
 * Resolve the sections a batch of executed actions touched.
 *
 * Returns ALL if any action is unmapped — one unknown action in a batch
 * poisons the batch, because a narrow refresh that misses a write is the
 * failure this whole mechanism has to avoid.
 *
 * Every mutation implies `profile`: XP, level and streak move as a side effect
 * of most writes, and attributing that per action across 155 handlers would be
 * guesswork. It is one row, and this path is a backstop for realtime having
 * missed the change in the first place.
 */
export function sectionsForActions(types: readonly string[]): RefreshTarget {
  if (types.length === 0) return [];

  const out = new Set<Section>();
  for (const raw of types) {
    const sections = SECTION_FOR[normalizeActionType(raw)];
    if (sections === undefined) return ALL;
    for (const s of sections) out.add(s);
  }

  if (out.size > 0) out.add("profile");
  return [...out];
}

/**
 * The first route offered by a batch, or null. First rather than last so the
 * suggestion tracks what the operator asked for, which is usually the opening
 * action of a chain.
 */
export function routeForActions(types: readonly string[]): string | null {
  for (const raw of types) {
    const route = ROUTE_FOR[normalizeActionType(raw)];
    if (route) return route;
  }
  return null;
}
