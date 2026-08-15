# Make Android login resilient

## Confirmed findings

- The live authentication settings and password-login endpoints both timed out after 15 seconds during this investigation.
- The backend control plane reports active, but database metrics also timed out, so the current incident includes a backend availability problem rather than incorrect credentials or a form validation bug.
- The Android app relies on browser visibility events and one fixed 800 ms retry. It does not use Capacitor's native foreground/background lifecycle to restart auth token refresh after a long suspension.
- When session initialization exhausts that short retry, the UI proceeds as signed out even though the persisted native session may still exist.

## Implementation

1. **Recover and verify the backend**
   - Restart the Lovable Cloud backend because its auth endpoints are currently unreachable despite the healthy control-plane status.
   - Wait for recovery, then verify both auth settings and a deliberately invalid password request return prompt, normal HTTP responses rather than timing out.

2. **Handle Android lifecycle correctly**
   - Add Capacitor's app lifecycle package.
   - On native foreground, restart auth auto-refresh and run a bounded session recovery attempt after the network stack has had time to reconnect.
   - On native background, stop auth auto-refresh so suspended timers cannot leave auth in a stale state.
   - Keep the existing browser behavior unchanged.

3. **Strengthen transient recovery**
   - Replace the one-shot fixed retry with a small exponential-backoff sequence for network-only/auth-retryable failures.
   - Preserve immediate failures for invalid credentials and other non-network auth errors.
   - Prevent the four-second initialization failsafe from racing an active recovery attempt and incorrectly presenting the login screen.

4. **Improve login failure behavior**
   - Use the same bounded recovery policy for password login and signup.
   - Show a clear temporary connectivity message after retries are exhausted, while keeping the form available for another attempt.
   - Do not erase stored credentials or session data because of a transient fetch failure.

5. **Validate the fix**
   - Add focused tests for retry timing, non-retryable credential errors, and exhausted network failures.
   - Verify normal login in the web preview.
   - Verify background-to-foreground recovery logic is registered only on native builds and does not create duplicate listeners.

## Technical scope

Expected files: auth context, transient retry helper/tests, login page, Capacitor dependencies/configuration, and a small native auth lifecycle initializer. No database schema or edge-function changes are required.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>