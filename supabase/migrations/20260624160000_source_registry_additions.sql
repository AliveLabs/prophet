-- Learning Spine — skill_source_registry tuning additions (2026-06-24, post-P14 review with Bryan).
--
-- Two gaps surfaced in the seeded-source review:
--   1. GRASSROOTS had NO external source (its guerrilla@v2 knowledge cited LSM/fundraiser tactics but
--      the registry fed it nothing) → add a reputable restaurant local-marketing source so the
--      grassroots skill can compound, not just run its static playbook.
--   2. The P9 deep-research PRIORITY-2 set (Datassential FoodBytes, FSR Magazine, US Foods Food
--      Fanatics) was researched but not seeded → Bryan: add as tier-2 enabled to widen the
--      corroboration pool (more independent sources agreeing = higher auto-promote confidence).
--
-- All tier-2, enabled, auth_kind='none' (free/scrapeable). Same gates apply: nothing reaches a brief
-- until status='active' (adversarial distill + ≥2-tier-1 corroboration / human promotion). Idempotent
-- via ON CONFLICT (url) DO NOTHING. URLs grounded via web verification 2026-06-24.
insert into skill_source_registry (skill_ids, name, vertical, url, fetch_strategy, auth_kind, trust_tier, enabled)
values
  -- (1) the grassroots/LSM gap-filler
  ('{"grassroots","marketing"}', 'Owner.com Restaurant Marketing Blog', 'marketing',
    'https://www.owner.com/blog', 'scrape', 'none', 2, true),
  -- (2) P9 priority-2 additions
  ('{"marketing","food-pairing"}', 'FSR Magazine', 'marketing',
    'https://www.fsrmagazine.com/rss.xml', 'scrape-browser-headers', 'none', 2, true),
  ('{"food-pairing","marketing"}', 'Datassential FoodBytes', 'culinary',
    'https://datassential.com/blog/', 'scrape', 'none', 2, true),
  ('{"food-pairing","marketing"}', 'US Foods Food Fanatics', 'culinary',
    'https://www.usfoods.com/great-food/food-fanatics.html', 'scrape', 'none', 2, true)
on conflict (url) do nothing;
