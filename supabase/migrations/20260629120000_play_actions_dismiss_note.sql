-- ALT-172 — capture the operator's optional free-text NOTE on a "this looks wrong" dismissal,
-- and treat that reason as DATA-QUALITY feedback (about bad third-party source data), NOT a
-- negative signal against our own recommendation model.
--
-- A "this looks wrong" complaint is almost always "your source data is off" (e.g. a wrong Google
-- hours/price/listing), which is NOT the model's fault — so it must NOT negatively reweight the
-- play-type in the learning rollup. The band (lib/skills/feedback-signals.ts) now routes
-- `dismissed:looks_wrong` as a NEUTRAL learning signal (zero model weight); the operator's note +
-- reason code are persisted here as a DATA-QUALITY record for a source-quality review queue.
--
-- One nullable free-text column holds the note. Additive + nullable ⇒ FAIL-SOFT: existing rows are
-- unaffected, and the capture path writes it best-effort (it falls back to writing without `note`
-- if this migration hasn't been applied yet). RLS is inherited from the existing play_actions
-- policies (org members can insert/update their own location's rows).

alter table play_actions add column if not exists note text;

comment on column play_actions.note is
  'Optional free-text operator note captured with a dismissal (ALT-172, surfaced for reason=looks_wrong). Treated as DATA-QUALITY feedback about third-party source data — NOT a negative signal against the recommendation model. NULL = no note. Bounded to a short note in the capture layer (brief-actions.ts).';
