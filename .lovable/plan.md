# Unfreeze login and backend

## Confirmed findings

- The control plane reports the backend as healthy, but the backend itself is not answering.
- Auth requests (both the settings endpoint and a deliberately-wrong password sign-in) hang and time out at 25 seconds with no HTTP response — this is exactly the "Failed to fetch" the app shows.
- Direct database queries fail too: the connection pooler times out (`Connection terminated due to connection timeout`).
- Auth and database both stalled while the control plane reports healthy means this is a backend-side stall, not wrong credentials and not a bug in the login form or app data hooks.

## Recovery steps

1. Restart the Lovable Cloud backend (needs your approval).
2. Poll status until it reports ready again.
3. Verify auth is actually serving: a wrong password must return a prompt `400 invalid credentials` instead of hanging.
4. Verify the database answers a trivial query quickly.
5. Sign in from the preview and confirm the session sticks and page data loads.
6. If the hang persists after the restart, stop and treat it as a platform incident rather than changing app code.

## Scope

No schema, edge-function, or frontend code changes are planned. The existing login already retries transient network failures with bounded backoff, so no code change would help while the backend is unreachable. If post-restart testing reveals a separate reproducible defect, I will report it before touching anything.
