#!/usr/bin/env bash
# =============================================================================
# VANTARA.EXE — Supabase Secrets Setup
# Interactive script to configure all required edge function secrets.
#
# Usage: ./scripts/set-secrets.sh
# Or set individual secrets: supabase secrets set KEY=value
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
prompt()  { echo -e "${BOLD}$*${RESET}"; }
skip()    { echo -e "${DIM}  (skipped)${RESET}"; }

set_secret() {
  local key="$1"
  local value="$2"
  if [ -n "$value" ]; then
    supabase secrets set "${key}=${value}" 2>/dev/null && success "Set: $key" || warn "Failed to set: $key"
  else
    skip
  fi
}

read_secret() {
  local prompt_text="$1"
  local var_name="$2"
  local required="${3:-optional}"

  if [ "$required" = "required" ]; then
    prompt "${prompt_text} ${RED}[required]${RESET}"
  else
    prompt "${prompt_text} ${DIM}[optional — press enter to skip]${RESET}"
  fi
  read -rsp "  > " value
  echo ""
  eval "$var_name='$value'"
}

echo ""
echo -e "${BOLD}${CYAN}══ VANTARA.EXE — Secrets Configuration ══${RESET}"
echo -e "${DIM}Secrets are encrypted and stored in your Supabase project.${RESET}"
echo -e "${DIM}They are never exposed to the frontend.${RESET}\n"

# ── CRITICAL SECRETS ──────────────────────────────────────────────────────────
echo -e "${BOLD}── Critical (MAVIS core) ──────────────────────────────────────────${RESET}\n"

read_secret "MAVIS_OPERATOR_MAIN_ID — Your Supabase user UUID (find in Auth → Users)" MAVIS_OPERATOR_MAIN_ID "required"
set_secret "MAVIS_OPERATOR_MAIN_ID" "$MAVIS_OPERATOR_MAIN_ID"

read_secret "MAVIS_OPERATOR_CALIYAH_ID — Caliyah's Supabase user UUID (if she has an account)" MAVIS_OPERATOR_CALIYAH_ID
set_secret "MAVIS_OPERATOR_CALIYAH_ID" "$MAVIS_OPERATOR_CALIYAH_ID"

read_secret "GEMINI_API_KEY — Google AI Studio (aistudio.google.com)" GEMINI_API_KEY "required"
set_secret "GEMINI_API_KEY" "$GEMINI_API_KEY"

read_secret "ANTHROPIC_API_KEY — Anthropic Console (console.anthropic.com)" ANTHROPIC_API_KEY "required"
set_secret "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"

read_secret "OPENAI_API — OpenAI Platform (platform.openai.com)" OPENAI_API "required"
set_secret "OPENAI_API" "$OPENAI_API"

# ── AI & VOICE ────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}── AI & Voice ─────────────────────────────────────────────────────${RESET}\n"

read_secret "FAL_API_KEY — fal.ai (fal.ai/dashboard) — video render + generation" FAL_API_KEY "required"
set_secret "FAL_API_KEY" "$FAL_API_KEY"

read_secret "ELEVENLABS_API_KEY — ElevenLabs voice synthesis" ELEVENLABS_API_KEY
set_secret "ELEVENLABS_API_KEY" "$ELEVENLABS_API_KEY"

read_secret "NVIDIA_API_KEY — NVIDIA NIM (PersonaPlex voice)" NVIDIA_API_KEY
set_secret "NVIDIA_API_KEY" "$NVIDIA_API_KEY"

read_secret "CARTESIA_API_KEY — Cartesia Sonic TTS" CARTESIA_API_KEY
set_secret "CARTESIA_API_KEY" "$CARTESIA_API_KEY"

# ── BILLING & COMMERCE ────────────────────────────────────────────────────────
echo -e "\n${BOLD}── Billing & Commerce ─────────────────────────────────────────────${RESET}\n"

read_secret "STRIPE_SECRET_KEY — Stripe secret key (sk_live_... or sk_test_...)" STRIPE_SECRET_KEY "required"
set_secret "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY"

read_secret "STRIPE_WEBHOOK_SECRET — Main Stripe webhook signing secret" STRIPE_WEBHOOK_SECRET
set_secret "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET"

read_secret "STRIPE_WEBHOOK_SECRET_WIDGETS — Widget subscription webhook signing secret" STRIPE_WEBHOOK_SECRET_WIDGETS
set_secret "STRIPE_WEBHOOK_SECRET_WIDGETS" "$STRIPE_WEBHOOK_SECRET_WIDGETS"

read_secret "GUMROAD_ACCESS_TOKEN — Gumroad product sales" GUMROAD_ACCESS_TOKEN
set_secret "GUMROAD_ACCESS_TOKEN" "$GUMROAD_ACCESS_TOKEN"

# ── SOCIAL & MESSAGING ────────────────────────────────────────────────────────
echo -e "\n${BOLD}── Social & Messaging ─────────────────────────────────────────────${RESET}\n"

read_secret "TELEGRAM_BOT_TOKEN — Telegram BotFather token" TELEGRAM_BOT_TOKEN
set_secret "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN"

read_secret "TWITTER_CONSUMER_KEY — Twitter/X API consumer key" TWITTER_CONSUMER_KEY
set_secret "TWITTER_CONSUMER_KEY" "$TWITTER_CONSUMER_KEY"

read_secret "TWITTER_CONSUMER_SECRET — Twitter/X API consumer secret" TWITTER_CONSUMER_SECRET
set_secret "TWITTER_CONSUMER_SECRET" "$TWITTER_CONSUMER_SECRET"

read_secret "TWITTER_ACCESS_TOKEN — Nora Vale access token" TWITTER_ACCESS_TOKEN
set_secret "TWITTER_ACCESS_TOKEN" "$TWITTER_ACCESS_TOKEN"

read_secret "TWITTER_ACCESS_TOKEN_SECRET — Nora Vale access token secret" TWITTER_ACCESS_TOKEN_SECRET
set_secret "TWITTER_ACCESS_TOKEN_SECRET" "$TWITTER_ACCESS_TOKEN_SECRET"

read_secret "RESEND_API_KEY — Transactional email (resend.com)" RESEND_API_KEY
set_secret "RESEND_API_KEY" "$RESEND_API_KEY"

# ── HEALTH & WEARABLES ────────────────────────────────────────────────────────
echo -e "\n${BOLD}── Health & Wearables ─────────────────────────────────────────────${RESET}\n"

read_secret "WHOOP_CLIENT_ID — WHOOP Developer Portal client ID" WHOOP_CLIENT_ID
set_secret "WHOOP_CLIENT_ID" "$WHOOP_CLIENT_ID"

read_secret "WHOOP_CLIENT_SECRET — WHOOP Developer Portal client secret" WHOOP_CLIENT_SECRET
set_secret "WHOOP_CLIENT_SECRET" "$WHOOP_CLIENT_SECRET"

read_secret "OURA_PERSONAL_ACCESS_TOKEN — Oura Ring personal token" OURA_PERSONAL_ACCESS_TOKEN
set_secret "OURA_PERSONAL_ACCESS_TOKEN" "$OURA_PERSONAL_ACCESS_TOKEN"

# ── MEMORY & PRODUCTIVITY ─────────────────────────────────────────────────────
echo -e "\n${BOLD}── Memory & Productivity ──────────────────────────────────────────${RESET}\n"

read_secret "MEM0_API_KEY — Mem0 persistent memory (app.mem0.ai)" MEM0_API_KEY
set_secret "MEM0_API_KEY" "$MEM0_API_KEY"

read_secret "RECLAIM_API_KEY — Reclaim.ai calendar defense" RECLAIM_API_KEY
set_secret "RECLAIM_API_KEY" "$RECLAIM_API_KEY"

read_secret "LETTA_API_KEY — Letta MemGPT agent API key" LETTA_API_KEY
set_secret "LETTA_API_KEY" "$LETTA_API_KEY"

# ── GOOGLE INTEGRATIONS ───────────────────────────────────────────────────────
echo -e "\n${BOLD}── Google Integrations ────────────────────────────────────────────${RESET}\n"

read_secret "GOOGLE_CLIENT_ID — Google OAuth client ID" GOOGLE_CLIENT_ID
set_secret "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"

read_secret "GOOGLE_CLIENT_SECRET — Google OAuth client secret" GOOGLE_CLIENT_SECRET
set_secret "GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══ Secrets configured ══${RESET}\n"
echo -e "Verify all secrets are set:"
echo -e "  ${CYAN}supabase secrets list${RESET}\n"

echo -e "${BOLD}Next: Register Stripe Webhooks${RESET}"
echo "  Widget subscriptions endpoint:"
echo "  https://wlygujlvsfimhtqsdxrx.supabase.co/functions/v1/stripe-widget-webhook"
echo ""
echo -e "${BOLD}Events to subscribe:${RESET}"
echo "  checkout.session.completed"
echo "  customer.subscription.updated"
echo "  customer.subscription.deleted"
echo "  invoice.payment_failed"
echo "  invoice.payment_succeeded"
echo ""
echo -e "${DIM}Supabase project: wlygujlvsfimhtqsdxrx${RESET}"
