# Fix MAVIS chat "unable to respond" and voice overlay

## What the logs show so far
- Your free AI providers are exhausted right now: Gemini says prepaid credits are depleted (402), Groq hit its daily limit (429). Earlier checks also showed Anthropic out of credit and Grok at its monthly limit.
- The Lovable AI fallback (the last resort) hasn't been called since 13:00 UTC today, so replies aren't reaching it.
- No MAVIS chat or voice requests appear in the backend logs in the last 3 hours, so the failure may happen before the request lands, or the cascade is giving up before the last resort.

Root cause is not confirmed yet — step 1 confirms it.

## Steps
1. Send one signed-in test message to MAVIS chat and one to the voice functions, and read the exact response and logs (cheap, one request each).
2. Fix whichever is confirmed:
   - If the cascade stops before the Lovable AI fallback: make sure exhausted providers are skipped quickly and the fallback is always tried last, for chat and voice.
   - If the request never reaches the backend (sign-in/token problem): fix how the chat page and voice overlay send the request.
3. Redeploy only the affected functions and re-run the same test to confirm a real reply comes back, in chat and in voice.

## Note for you
Topping up Gemini or waiting for Groq's daily reset (midnight UTC) also restores the free tiers; until then replies will use Lovable AI credits.
