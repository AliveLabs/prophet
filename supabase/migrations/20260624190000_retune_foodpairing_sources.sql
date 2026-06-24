-- Source→skill retune: keep food-pairing fed by CULINARY sources only.
--
-- The first live ingest revealed food-pairing was receiving general restaurant-ECONOMICS content because
-- two industry/economics sources (NRA Restaurant Economic Insights, Black Box Intelligence) carried
-- 'food-pairing' in their skill_ids. Reroute those two to operations/positioning/marketing where the
-- economic-indicator + traffic/turnover/segment content belongs. The culinary sources (NRA What's Hot,
-- Datassential FoodBytes, US Foods Food Fanatics — and the menu-trade feeds FSR/NRN) keep food-pairing.
-- Data-only (skill_ids); takes effect on the next ingest run. Idempotent (sets the target arrays).
update skill_source_registry
  set skill_ids = '{"operations","marketing"}', updated_at = now()
  where name like 'Black Box Intelligence%';

update skill_source_registry
  set skill_ids = '{"operations","positioning","marketing"}', updated_at = now()
  where name like 'NRA Restaurant Economic Insights%';
