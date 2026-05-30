-- ═══════════════════════════════════════════════════════════
-- MAVIS REVENUE — add gumroad_sale_id
-- Tracks Gumroad sale reference alongside existing stripe_payment_id.
-- ═══════════════════════════════════════════════════════════

alter table mavis_revenue add column if not exists gumroad_sale_id text;
create index if not exists idx_mavis_revenue_gumroad on mavis_revenue(gumroad_sale_id) where gumroad_sale_id is not null;
