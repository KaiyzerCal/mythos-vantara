-- ═══════════════════════════════════════════════════════════
-- MAVIS PRODUCTS — pdf_url + platform columns
-- pdf_url: public Supabase Storage URL for the generated PDF
-- platform: which sales platform the product was published to
-- ═══════════════════════════════════════════════════════════

alter table mavis_products add column if not exists pdf_url text;
alter table mavis_products add column if not exists platform text
  default 'gumroad'
  check (platform in ('gumroad', 'stripe'));
