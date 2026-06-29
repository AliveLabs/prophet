-- Thread the dismissal REASON into the learning loop.
--
-- The brief's "Remove" flow now captures WHY a play was dismissed (TkDismissReason), and a reasoned
-- Remove DISAMBIGUATES an otherwise-ambiguous dismissal into a directional learning signal: the band
-- (lib/skills/feedback-signals.ts) maps `dismissed:<code>` to its own {polarity,weight,confidence}, so
-- "this looks wrong" reads negative while "already doing it" stays neutral. A bare Remove (NULL reason)
-- keeps its old contract: visibility-only, zero learning weight.
--
-- One nullable column holds the stable reason CODE (not_relevant | already_doing | looks_wrong). It is
-- intentionally FREE-TEXT (no CHECK) so retuning the reason set is a band edit, never a migration — the
-- engine degrades any unrecognized code to a neutral no-op via signalFor()/dismissActionFor().
--
-- Additive + nullable ⇒ FAIL-SOFT: existing rows are unaffected, and the rollup reads the column
-- best-effort (it falls back to reading without `reason` if this migration hasn't been applied yet).

alter table play_actions add column if not exists reason text;

comment on column play_actions.reason is
  'Optional stable dismissal-reason code (not_relevant|already_doing|looks_wrong) for action=dismissed. Disambiguates a Remove into a directional learning signal; NULL = bare visibility-only dismissal. Semantics live in lib/skills/feedback-signals.ts (DISMISS_REASONS + the dismissed:<code> band entries).';
