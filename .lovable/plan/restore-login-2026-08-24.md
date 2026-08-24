# Restore login

## Confirmed diagnosis

- The sign-in endpoint (`/auth/v1/token?grant_type=password`) times out at the origin after ~20 seconds and returns a Cloudflare 522 ("Connection timed out"), which is exactly the `Failed to fetch` the app reports.
- A lightweight auth health request does return quickly, so DNS and the edge are fine — the auth service itself is not completing token requests.
- The Lovable Cloud control plane reports the backend as up, so this is a service-side stall, not wrong credentials and not a bug in the login form.
- The app's login already retries transient network failures with bounded backoff, so no frontend change would help here.

## Recovery steps

1. Restart the Lovable Cloud backend (needs your approval).
2. Wait for it to report ready, then re-test the real password endpoint until it returns a prompt HTTP response instead of a 522.
3. Confirm a deliberately wrong password returns a normal "invalid credentials" error, proving auth is serving again.
4. Sign in from the app to verify the session persists and the app does not fall back to the login screen.
5. If the 522 persists after restart, stop and treat it as a platform incident rather than changing app code.

## Scope

No schema, edge-function, credential, or frontend code changes are planned unless testing after the restart reveals a separate reproducible defect.
