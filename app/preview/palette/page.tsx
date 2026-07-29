// DEV/REVIEW-ONLY — the Ticket colour palette (no auth, prod-guarded by the /preview
// layout). Everything is read live from app/editorial-tokens.css, which is the single
// source of truth, so this page cannot drift from the real system.

import ThemeToggle from "@/components/ui/theme-toggle"
import PaletteView from "./palette-view"
import ButtonChipSpec from "./button-chip-spec"
import "./palette.css"

const SHADOWS = ["--shadow-sm", "--shadow-md", "--shadow-lg"]
const RADII = ["--r-sm", "--r-md", "--r-lg", "--r-xl"]

export default function PalettePreview() {
  return (
    <div className="pv-page pal-scope tk-kit">
      <div className="pv-page-head">
        <div className="pal-topbar">
          <span className="pv-kicker">Design tokens</span>
          <ThemeToggle className="pv-theme-btn" />
        </div>
        <h1 className="pv-h1">Ticket colour palette</h1>
        <p className="pv-sub">
          Read live from <code>app/editorial-tokens.css</code>, the single source of truth. Every
          value and every contrast ratio below is computed at render, not typed in, so this page
          cannot go stale. Flip the toggle to see the dark peer: it overrides colour only, and
          inherits radii, motion and type unchanged.
        </p>
      </div>
      <hr className="pv-rule" />

      <PaletteView />

      {/* ── How the insight card uses this ── */}
      <section className="pal-group">
        <div className="pal-grouphead">
          <h2>Applied: the insight card&rsquo;s axes</h2>
          <p>
            The card assigns colour by <b>what the tag means</b>, never by how it looks. One axis,
            one colour, so a reader can tell which kind of thing they are looking at.
          </p>
        </div>
        <div className="pal-axes">
          <div className="pal-axis">
            <span className="uic-tag uic-tag-what">Google Business Profile</span>
            <div>
              <b>What</b>
              <span>Where it came from.</span>
              <code>--slate-deep on --slate-tint · 9.25</code>
            </div>
          </div>
          <div className="pal-axis">
            <span className="uic-tag uic-tag-when">This week</span>
            <div>
              <b>When</b>
              <span>How soon it matters.</span>
              <code>--teal-deep on --teal-tint · 5.09</code>
            </div>
          </div>
          <div className="pal-axis">
            <span className="uic-tag uic-tag-urgent">Next day or two</span>
            <div>
              <b>When, soonest tier</b>
              <span>The nearest-term band.</span>
              <code>--alert-deep on --alert-wash · 5.10</code>
            </div>
          </div>
          <div className="pal-axis">
            <span className="uic-tag uic-tag-state">On this week&rsquo;s brief</span>
            <div>
              <b>State</b>
              <span>Its status in the product.</span>
              <code>--gold-deep on --gold-tint · 4.69</code>
            </div>
          </div>
        </div>
        <p className="pal-axisnote">
          Text is each family&rsquo;s own <code>-deep</code> on its own <code>-tint</code>, which is
          the only pairing that clears AA on all four in <b>both</b> themes. Ratios above are light;
          dark runs 7.57 / 7.13 / 5.91 / 8.50, so dark is comfortably the stronger theme here too.
        </p>
        <p className="pal-axisnote">
          <b>Two things to look at before this is settled.</b> First, all four fills sit inside a
          5.5&#37; luminance band (<code>0.758</code> to <code>0.813</code>), so they are separated by
          hue alone, at low saturation, in an 11px pill. Second, and following from that, the
          soonest tier is now the <em>least</em> prominent of the four rather than the most: at{" "}
          <code>0.758</code> <code>--alert-wash</code> is simply another pale wash, where a filled
          treatment made &ldquo;now&rdquo; unmissable. The glance test in the panels below is the
          honest way to judge both.
        </p>
        <p className="pal-axisnote">
          Worth naming: this mapping puts <b>gold on state</b>, which is good news, and{" "}
          <b>green on timing</b>. Earlier you read gold as signalling &ldquo;something else might be
          happening&rdquo; and liked green for state. Not an objection, just checking it is a
          deliberate reversal rather than a slip.
        </p>
      </section>

      {/* ── Buttons + chips, both themes at once ── */}
      <section className="pal-group">
        <div className="pal-grouphead">
          <h2>Buttons and chips, both themes</h2>
          <p>
            Your values, with the dark side patterned after them by <b>role</b> rather than by
            literal token. Every button radius is <code>--r-sm</code>: <code>--r-md</code> was
            correct as specified but read too round at this button height. Tertiary now carries no
            outline in either theme. Three states needed a deviation, called out below the panels.
            Hover and press these, they are the real CSS.
          </p>
        </div>
        <div className="pal-themes">
          <ButtonChipSpec theme="light" />
          <ButtonChipSpec theme="dark" />
        </div>
        <ol className="pal-issues pal-dev">
          <li>
            <b>Light, secondary press.</b> No label colour was specified, and keeping{" "}
            <code>--ink</code> on <code>--ink-2</code> measures <b>2.16, a hard fail</b>. The press
            now inverts the label to <code>--card</code>, giving 7.61. That also matches what the
            tertiary press already does, so the pattern is consistent rather than a one-off.
          </li>
          <li>
            <b>Dark press, now one rule for every tier.</b> Primary&rsquo;s own rest pair inverted:
            fill <code>--card</code>, label <code>--rust</code>. Contrast is symmetric, so this is
            the same <b>5.17</b> as primary at rest, and it replaces the three separate per-tier
            dark press rules that were here before. One trade-off: on a{" "}
            <code>--card</code> surface the fill equals the ground, so while the button is held it
            loses its silhouette and reads as rust text alone. One line adds a{" "}
            <code>--rust</code> border back if that bothers you.
          </li>
          <li>
            <b>Dark, secondary hover.</b> <code>--ash-2</code> is light in dark mode, so{" "}
            <code>--ink</code> on it is <b>4.04</b>, large-text only. Dark hovers to{" "}
            <code>--line-2</code> instead (8.70), which is still one step off{" "}
            <code>--ledger</code> and reads as the same gesture.
          </li>
          <li>
            <b>Dark, tertiary hover.</b> Not a contrast problem, a visibility one:{" "}
            <code>--press @15%</code> <em>darkens</em>, which is invisible on an already dark card.
            Dark lightens with <code>--ink @10%</code> instead, so the hover is the same
            &ldquo;step toward the ink&rdquo; gesture in both themes.
          </li>
          <li>
            <b>Primary at rest is tight.</b> <code>--card</code> on <code>--rust</code> is{" "}
            <b>4.54</b> in light, clearing AA by 0.04 on the most-used button in the product. It
            passes, but any future lightening of <code>--rust</code> breaks it. Dark is
            healthier at 5.17.
          </li>
        </ol>
      </section>

      {/* ── Elevation + radii, since they live in the same token file ── */}
      <section className="pal-group">
        <div className="pal-grouphead">
          <h2>Elevation and radii</h2>
          <p>Not colour, but same file, and both shift in dark mode: shadows go far deeper.</p>
        </div>
        <div className="pal-elev">
          {SHADOWS.map((s) => (
            <div key={s} className="pal-elevbox" style={{ boxShadow: `var(${s})` }}>
              <code>{s}</code>
            </div>
          ))}
        </div>
        <div className="pal-radii">
          {RADII.map((r) => (
            <div key={r} className="pal-radbox" style={{ borderRadius: `var(${r})` }}>
              <code>{r}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ── What I would change ── */}
      <section className="pal-group">
        <div className="pal-grouphead">
          <h2>What I would flag</h2>
          <p>Things I noticed reading the file, not changes I have made.</p>
        </div>
        <ol className="pal-issues">
          <li>
            <b>The four-step family scale is only half real.</b> The system promises
            base / -2 / -deep / -tint, but in light mode <code>--teal-2</code> and{" "}
            <code>--teal-deep</code> are the same value, and so are{" "}
            <code>--slate-2</code>/<code>--slate-deep</code> and{" "}
            <code>--alert-2</code>/<code>--alert-deep</code>. Only rust and gold have a distinct
            -2. In dark it inverts: <code>--teal</code>/<code>--teal-2</code> collapse, and so do{" "}
            <code>--gold</code>/<code>--gold-2</code>. So &ldquo;use -2 for hover&rdquo; silently
            does nothing on three of five families.
            <br />
            Worst case is <code>#2E6B54</code>, which answers to <b>three</b> different token names
            at once: <code>--teal-2</code>, <code>--teal-deep</code> and <code>--clear-2</code>.
          </li>
          <li>
            <b><code>--bond</code> and <code>--paper-2</code> are effectively the same colour</b>{" "}
            in light: <code>#F4EFE8</code> against <code>#F3EFE8</code>, one step apart in a single
            channel. Two names for one value means two ways to write the same intent.
          </li>
          <li>
            <b>Nine legacy aliases are still live</b> (<code>--print</code>, <code>--ash</code>,{" "}
            <code>--ash-2</code>, <code>--clear</code>, <code>--clear-2</code>,{" "}
            <code>--clear-wash</code>, <code>--wire-gold</code>, <code>--ledger</code>, plus{" "}
            <code>--shadow-chit</code> and <code>--shadow-lift</code>). They were kept so old rules
            keep resolving, which was right at the time, but they now let new code pick a legacy
            name without knowing it.
          </li>
          <li>
            <b><code>--ash-2</code> is the only real contrast failure, and it is not the one the
            file warns about.</b> Measured above: <code>--ash-2</code> lands at{" "}
            <b>2.94 on paper</b>, which misses even the 3.0 floor for large text, and 3.12 on card,
            which is large-text-only. Anything using it for real copy is below AA.{" "}
            <b>This is a light-mode-only failure</b>: in dark it lifts to 3.87 on paper, which is
            still large-text-only but no longer under the floor. Dark is the stronger theme on
            contrast across the whole ink ramp.
            <br />
            Meanwhile <code>--ink-3</code>, which the token file hedges as &ldquo;≥14px or
            sparing&rdquo;, actually clears AA at any size: <b>4.98 on paper, 5.28 on card</b>{" "}
            against a 4.5 threshold. So that comment is more conservative than the maths, and the
            card&rsquo;s 11px <b>what</b> tag is fine. It does miss AAA, so it is a poor choice for
            long-form body copy, but it is not a violation.
          </li>
          <li>
            <b><code>--signal</code> belongs to no family.</b> It is a rust-adjacent orange with no
            -deep or -tint, so it cannot be used for small text or a wash without inventing values.
          </li>
        </ol>
      </section>
    </div>
  )
}
