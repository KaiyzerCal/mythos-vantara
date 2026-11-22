# Monitoring fixes

- [x] Preserve Black Sun direct gains before convergence; run regression tests.
- [x] Correct Telegram profile and energy fields; verify quest fields and run regression tests.
- [x] Deploy mavis-actions and mavis-telegram-bot; preview build and all 22 targeted tests pass.
- [ ] Verify live quest completion and Telegram replies — requires a controlled quest completion and Telegram message; not exercised during infrastructure recovery.
- [x] Recover the unresponsive backend: restart completed, database query succeeded, auth/database health checks passed, and signed-in dashboard profile/quest/energy reads returned 200. Memory 35%, disk 11%, connections 7/60; no instance upgrade needed.