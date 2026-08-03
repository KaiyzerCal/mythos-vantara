// Shared fixtures for hook tests. The chainable supabase-js query-builder
// mock itself is NOT exported from here: vi.mock() factories are hoisted
// above all imports, so a test file's `vi.fn()` mock target for
// `supabase.from` has to be declared inside its own top-level
// `vi.hoisted()` block, not imported from a shared module — see
// src/hooks/__tests__/useDataHooks.test.ts for the pattern.
export const AUTH_SESSION_FIXTURE = {
  access_token: "test-access-token",
  user: { id: "test-user-id", email: "test@example.com" },
};
