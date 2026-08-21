# Bug-class audit: plan, model selection, and cost discipline

> Living document. Started 2026-08-21 after a run of small, expensive-to-find bugs.
> Owner: Bryan. Authoritative over any chat summary.

## The question this answers

Ticket is 706 source files, 128,269 lines, 1,291 exported functions, 222 test files. It is full of
real bugs and we keep finding them one at a time, by accident, sometimes after a customer has already
seen the wrong number. How do we find them on purpose, at a cost we can afford, without producing a
backlog nobody works?

## Why "review each function and mark it reviewed" is the wrong unit

The instinct is right: we need systematic coverage with durable state. The **unit** is wrong.

Every bug found in the 2026-08-19 to 08-21 window was **relational**. It lived in the gap between two
places, and each half read as correct on its own:

| Bug | Caught by reading that one function? |
|---|---|
| "Never onboarded" counted org attachment, not activation | **No.** `!!profile?.current_organization_id` is fine in isolation |
| "Local search visibility" label on US-national data | **No.** Label in `lib/skills/`, `?? 2840` in `lib/providers/` |
| Provisioning wrote `metadata.status: "watched"`, readers want `"approved"` | **No.** The writer was internally consistent |
| Dossier read the latest thin menu, 3 siblings unioned | **No.** That function was self-consistent |
| `review_watch_events` merged but never applied to prod | **No.** Every line of code is correct |
| `location_code ?? 2840` never overridden by any caller | **No.** The client is correct; the callers are the bug |
| Additional-location price $229 undercut a $99 base | **No.** Each price is fine alone |
| Two `DISPLAY_NAMES` maps disagreeing across 8 call sites | **No.** Each map is fine alone |

**Eight for eight.** A per-function sweep of 1,291 functions would have been the most expensive
possible way to find none of them.

So: **audit invariants, not functions.** An invariant spans the gap where these bugs live.

### The cautionary tale is already in this directory

`docs/audit/grep-*.txt` (June 2026) are the evidence files of the last audit. All seven contain
exactly one line: `(eval):1: command not found: rg`. The tool was never installed, the audit
"completed", the empty results were committed, and nobody noticed for four months.

**An audit whose output is prose or text files decays to zero.** The only output that holds is a
test or a checker that fails.

---

## The bug classes

Each is drawn from a real incident, not imagined. This list is the audit's actual scope.

| # | Class | The invariant | Real incident |
|---|---|---|---|
| 1 | **Claim vs computation** | Every user-visible claim is supported by the predicate behind it | "Never onboarded", "Local search visibility", "Active in last 7 days" said "signed in" while reading `last_seen_at` |
| 2 | **Writer/reader string agreement** | The set of magic strings written to a jsonb field equals the set read from it | `metadata.status` `"watched"` vs `"approved"` |
| 3 | **Duplicated derivation** | One fact is computed in exactly one place | 4 copies of the menu snapshot query; 2 `DISPLAY_NAMES` maps; 4 copies of the onboarding predicate |
| 4 | **Code vs schema parity** | Every merged migration's objects exist in prod | `review_watch_events` (twice: ALT-677, then again 08-21) |
| 5 | **Code vs env parity** | Every env name the code reads exists in each environment | Verified by hand for 12 Stripe price IDs on 08-20 |
| 6 | **Unoverridden defaults** | A `?? <literal>` default is either overridden somewhere or is genuinely intended | `location_code ?? 2840` in 10 clients, 12 call sites, never overridden |
| 7 | **Fail-soft masking** | Degradation is distinguishable from health | `loadActiveWatchEvents` returns `[]` on error, silently disabling dedupe; producers served 16k-truncated fallbacks for two weeks |
| 8 | **Money invariants** | Cross-price and quantity relationships hold | $229 add-on vs $99 base; `items.data[0]` assumed to be the plan |
| 9 | **Gate actually gates** | The thing sold as the tier difference is what the code branches on | `briefingCadence` had zero readers while `eventsCadence` gated the run |

### Classes 4 and 5 are scripts, not agents

They are deterministic diffs. Paying model tokens to run a diff is pure waste, and worse, it is a
diff whose result nobody can reproduce next month. Write them once as `npm run` checks and they cost
nothing forever after.

---

## Three layers

### Layer 1: mechanical checkers in CI (do this first)

Convert each class, as far as it will go, into a check that fails.

Precedent in this repo, all three of which have already caught real bugs:

- `lint:rsc-boundary` (`scripts/audit/rsc-boundary.mjs`)
- the ALT-363 source assertion that forbids re-adding a private menu query
  (`tests/unit/content/menu-history.test.ts`)
- the pricing guard test that caught the live $229/$99 arbitrage **on its first run**

Note that **eslint cannot gate** here: it reports ~1,344 pre-existing errors, so a red lint means
nothing. New checkers must be their own `npm run` targets with clean baselines.

### Layer 2: agent sweep, one class per agent, whole repo

Not one agent per directory. **One agent per invariant, across all 706 files**, because the bug is
the disagreement between files. Each finding must come back as `file:line`, the disagreeing
counterpart, and a proposed failing test.

### Layer 3: the ledger, for the long tail

Your "mark it reviewed" idea, applied to modules rather than functions, and keyed so we never pay
twice.

`docs/audit/ledger.json`:

```json
{
  "lib/billing/limits.ts": {
    "blobSha": "a3f9c1e...",
    "reviewedAt": "2026-08-21",
    "classesChecked": [1, 2, 3, 8],
    "findings": ["ALT-7xx"],
    "model": "opus-5/high"
  }
}
```

- **Keyed on the git blob SHA**, so a reviewed-and-unchanged file is never re-reviewed, and any edit
  automatically re-opens it. This is the mechanism that makes repeating the audit affordable.
- **In the repo, not the vault**, so CI can read it and it survives a lost session.
- **Ranked by blast radius**: money, then customer-facing claims, then data correctness. Never
  alphabetical, never by file size.

---

## Model and effort selection

The controlling idea: **enumeration is cheap and needs no judgment; judgment is expensive and needs
no enumeration.** Split every class along that line and pay the high rate only for the shortlist.

### Orchestration

| Role | Model | Effort | Why |
|---|---|---|---|
| Main loop: scoping, triage, synthesis, deciding what is real | **Opus 5** | **high** | The value is in judging whether a finding is a bug or a misread. That is precisely where a cheaper model produces a backlog of noise that costs Bryan's attention, which is the scarcest resource here |

### Per class

| # | Class | Model | Effort | Why this tier |
|---|---|---|---|---|
| 1 | Claim vs computation | **Opus 5** | **xhigh** | The hardest class and the highest yield. Requires holding UI copy and a predicate from a different directory in mind at once and judging support. This is the class that produced both 08-20 and 08-21 fixes |
| 7 | Fail-soft masking | **Opus 5** | **high** | Must distinguish deliberate fail-open from a masking bug. `CLAUDE.md` explicitly forbids hardening the fleet-cap fail-open and the surface-readiness gate. A weaker model files those as bugs and burns trust |
| 8 | Money invariants | **Opus 5** | **high** | Highest harm per miss. Wrong here means wrong invoices |
| 3 | Duplicated derivation | **Sonnet 5** | **high** | Finding copies is mechanical; deciding whether they diverged *semantically* needs real reasoning, but within Sonnet's range |
| 9 | Gate actually gates | **Sonnet 5** | **high** | Trace a config field to its branch. Bounded and concrete |
| 2 | Writer/reader strings | **Sonnet 5** | **medium** | Mostly enumeration plus set comparison |
| 6 | Unoverridden defaults | **Sonnet 5** | **medium** | Census plus light judgment on intent |
| 4 | Schema parity | **script** | n/a | Deterministic. Never pay tokens twice |
| 5 | Env parity | **script** | n/a | Deterministic. Never pay tokens twice |

### Cross-cutting stages

| Stage | Model | Effort | Why |
|---|---|---|---|
| **Candidate enumeration** (feeds every class) | **Haiku 4.5** | **low** | Harvesting literals, call sites, `catch` blocks, UI strings. This is 90% of the file-reading volume and 0% of the judgment. Running it on Opus is the single biggest way to waste money here |
| **Adversarial verification** of each surviving finding | **Opus 5** | **high** | One verifier per finding, prompted to *refute*. A plausible-but-wrong finding is worse than no finding, because it spends Bryan's attention and teaches him to distrust the list |
| **Checker implementation** from a written spec | **Sonnet 5** | **medium** | Codegen against a spec. The spec is the hard part and comes from the main loop |
| **Layer 3 bulk module review** | **Sonnet 5** | **medium** | Volume work. Escalate a module to Opus 5 / high when it sits in the money or claims path |
| **Ledger bookkeeping** | **script** | n/a | Hashing and staleness listing is not model work |

---

## Cost discipline

1. **Deterministic work becomes a script, permanently.** Classes 4 and 5, and all ledger mechanics.
2. **Two-stage every class**: Haiku enumerates candidates, the class model judges the shortlist.
3. **Ledger keyed on blob SHA**: unchanged code is never re-reviewed.
4. **WIP cap of ~10 open findings.** Finding is cheap; fixing, testing and verifying is not. A
   200-item list is a liability, not an asset.
5. **Every finding lands as a test that fails when reverted.** Both 08-20 and 08-21 fixes were
   verified by actually reverting the code and watching the guard fail. Assert nothing you have not
   watched fail.
6. **Calibrate before committing.** Run **class 1 only**, end to end, measure real token spend and
   real finding quality, then decide whether to fund the other eight. Do not authorise nine sweeps
   against an estimate.

## Order of execution

1. **Class 4 + 5 checkers** (scripts). Both have already bitten twice, both are cheap, both are
   permanent. `review_watch_events` is outstanding right now.
2. **Class 1 sweep** as the calibration run. Highest yield, and it produces the cost data needed to
   plan the rest.
3. **Class 8** (money), because marketing is live and this is what a paying customer feels.
4. Reassess with real numbers. Then classes 2, 3, 6, 7, 9, and stand up the ledger for the tail.

## Definition of done, per class

A class is "done" when:

- it has a checker or a test that fails on the original bug,
- that failure has been **observed**, not assumed,
- the ledger records which modules were swept, at which blob SHA, by which model and effort,
- and any finding too large to fix now is a ticket with the failing test already written.

## Delete on first pass

`docs/audit/grep-*.txt` and `docs/audit/verticalization-grep-audit.md`: four months stale, and the
evidence files contain a shell error rather than results.
