#!/usr/bin/env bash
# =============================================================================
# VANTARA.EXE — Full Deployment Script
# Applies migrations, deploys all edge functions, creates storage buckets.
#
# Prerequisites:
#   1. Supabase CLI installed: npm install -g supabase
#   2. Logged in: supabase login
#   3. Project linked: supabase link --project-ref wlygujlvsfimhtqsdxrx
#
# Usage:
#   ./scripts/deploy.sh              — full deploy (migrations + functions + buckets)
#   ./scripts/deploy.sh --functions  — functions only (skip migrations + buckets)
#   ./scripts/deploy.sh --migrate    — migrations only
#   ./scripts/deploy.sh --buckets    — storage buckets only
# =============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸ $*${RESET}"; }
success() { echo -e "${GREEN}✓ $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠ $*${RESET}"; }
error()   { echo -e "${RED}✗ $*${RESET}"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }

# ── Parse flags ───────────────────────────────────────────────────────────────
DO_MIGRATE=true
DO_FUNCTIONS=true
DO_BUCKETS=true

for arg in "$@"; do
  case $arg in
    --functions) DO_MIGRATE=false; DO_BUCKETS=false ;;
    --migrate)   DO_FUNCTIONS=false; DO_BUCKETS=false ;;
    --buckets)   DO_MIGRATE=false; DO_FUNCTIONS=false ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────────────────
header "VANTARA Deployment"

if ! command -v supabase &> /dev/null; then
  error "Supabase CLI not found. Install with: npm install -g supabase"
fi

info "Supabase CLI: $(supabase --version)"

# Verify project is linked
if ! supabase status &>/dev/null; then
  warn "Project not linked. Linking to wlygujlvsfimhtqsdxrx..."
  supabase link --project-ref wlygujlvsfimhtqsdxrx
fi

# ── 1. Database Migrations ────────────────────────────────────────────────────
if [ "$DO_MIGRATE" = true ]; then
  header "Applying Database Migrations"
  info "Pushing all pending migrations to remote..."
  supabase db push
  success "Migrations applied"
fi

# ── 2. Storage Buckets ────────────────────────────────────────────────────────
if [ "$DO_BUCKETS" = true ]; then
  header "Creating Storage Buckets"

  BUCKETS=(
    "video-projects:public"
    "widgets:public"
    "avatars:public"
    "vault-files:private"
    "voice-memos:private"
  )

  for entry in "${BUCKETS[@]}"; do
    name="${entry%%:*}"
    visibility="${entry##*:}"
    info "Ensuring bucket: $name ($visibility)..."
    if [ "$visibility" = "public" ]; then
      supabase storage buckets create "$name" --public 2>/dev/null \
        && success "Created: $name" \
        || warn "Already exists: $name (ok)"
    else
      supabase storage buckets create "$name" 2>/dev/null \
        && success "Created: $name (private)" \
        || warn "Already exists: $name (ok)"
    fi
  done
fi

# ── 3. Edge Functions ─────────────────────────────────────────────────────────
if [ "$DO_FUNCTIONS" = true ]; then
  header "Deploying Edge Functions"

  # All functions in supabase/functions/
  FUNCTIONS_DIR="supabase/functions"
  FAILED=()
  DEPLOYED=0

  for fn_dir in "$FUNCTIONS_DIR"/*/; do
    fn_name=$(basename "$fn_dir")
    info "Deploying: $fn_name"
    if supabase functions deploy "$fn_name" --no-verify-jwt 2>/dev/null \
      || supabase functions deploy "$fn_name" 2>/dev/null; then
      DEPLOYED=$((DEPLOYED + 1))
    else
      warn "Failed: $fn_name (check logs)"
      FAILED+=("$fn_name")
    fi
  done

  success "Deployed $DEPLOYED functions"

  if [ ${#FAILED[@]} -gt 0 ]; then
    warn "The following functions failed to deploy:"
    for fn in "${FAILED[@]}"; do
      echo "    - $fn"
    done
    echo ""
    warn "Re-deploy a single function with: supabase functions deploy <name>"
  fi
fi

# ── 4. Post-Deploy Checklist ──────────────────────────────────────────────────
header "Post-Deploy Checklist"

echo -e "${BOLD}REQUIRED: Set these secrets in Supabase Dashboard${RESET}"
echo -e "  Dashboard → Settings → Edge Functions → Secrets\n"
echo -e "  ${YELLOW}Run: ./scripts/set-secrets.sh to set them via CLI${RESET}\n"

echo -e "${BOLD}Critical (MAVIS won't function without these):${RESET}"
echo "  GEMINI_API_KEY              — Google AI Studio"
echo "  ANTHROPIC_API_KEY           — console.anthropic.com"
echo "  OPENAI_API                  — platform.openai.com"
echo "  MAVIS_OPERATOR_MAIN_ID      — Your Supabase user ID (locks MAVIS to you)"

echo -e "\n${BOLD}Feature-specific:${RESET}"
echo "  FAL_API_KEY                 — fal.ai (video render + generation)"
echo "  ELEVENLABS_API_KEY          — Voice synthesis"
echo "  STRIPE_SECRET_KEY           — Revenue + widget subscriptions"
echo "  STRIPE_WEBHOOK_SECRET       — Supabase stripe-widget-webhook endpoint"
echo "  STRIPE_WEBHOOK_SECRET_WIDGETS — Widget subscription webhook"
echo "  TELEGRAM_BOT_TOKEN          — Telegram bot"
echo "  NVIDIA_API_KEY              — PersonaPlex voice (NIM)"
echo "  MEM0_API_KEY                — Persistent AI memory"
echo "  WHOOP_CLIENT_ID             — WHOOP health sync"
echo "  WHOOP_CLIENT_SECRET         — WHOOP health sync"
echo "  RECLAIM_API_KEY             — Calendar defense"

echo -e "\n${BOLD}REQUIRED: Register Stripe Webhook${RESET}"
echo "  1. Go to Stripe Dashboard → Developers → Webhooks"
echo "  2. Add endpoint:"
echo "     https://wlygujlvsfimhtqsdxrx.supabase.co/functions/v1/stripe-widget-webhook"
echo "  3. Select events:"
echo "     • checkout.session.completed"
echo "     • customer.subscription.updated"
echo "     • customer.subscription.deleted"
echo "     • invoice.payment_failed"
echo "     • invoice.payment_succeeded"
echo "  4. Copy the Signing Secret → set as STRIPE_WEBHOOK_SECRET_WIDGETS"

echo -e "\n${BOLD}REQUIRED: Set your operator user ID${RESET}"
echo "  1. Go to Supabase Dashboard → Authentication → Users"
echo "  2. Find your user row and copy the UUID"
echo "  3. Run: supabase secrets set MAVIS_OPERATOR_MAIN_ID=<your-uuid>"
echo "  4. If Caliyah has an account: supabase secrets set MAVIS_OPERATOR_CALIYAH_ID=<uuid>"

echo ""
success "Deployment complete. Run ./scripts/set-secrets.sh to configure secrets."
