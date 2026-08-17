# Recover and verify login

## Confirmed diagnosis

- The app’s login flow already retries transient network failures with bounded exponential backoff.
- The live authentication endpoint did not respond within 15 seconds.
- Database health metrics also timed out, although the Lovable Cloud control plane reports the backend as active.
- This points to a backend availability incident, not invalid credentials or a login-form bug.

## Recovery plan

1. Restart the Lovable Cloud backend as approved.
2. Wait until the control plane reports ready, then test the actual auth settings endpoint repeatedly until it returns a prompt HTTP response.
3. Test a deliberately invalid password request and confirm it returns a normal authentication error rather than `Failed to fetch` or a timeout.
4. Open the app and verify auth initialization completes without getting stuck or incorrectly discarding a persisted session.
5. If the backend remains unreachable after restart, stop making frontend changes and document it as an infrastructure incident requiring platform support.

## Scope

No schema, credential, edge-function, or frontend code changes are planned unless post-restart testing reveals a separate reproducible application defect.

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>