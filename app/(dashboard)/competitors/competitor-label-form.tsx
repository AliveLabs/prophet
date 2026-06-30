"use client"

// ALT-225 — set/clear an operator DISPLAY LABEL for this competitor (display-only).
// Posts updateCompetitorDisplayLabelAction; the label then shows INSTEAD of the canonical
// Google name everywhere this competitor renders. The raw name is never touched, so the
// Places link + matching stay intact. Reuses the page-scoped .tk-add-input styling.

import { useFormStatus } from "react-dom"
import { updateCompetitorDisplayLabelAction } from "./actions"
import { TkButton } from "@/components/ticket"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <TkButton type="submit" variant="act" disabled={pending}>
      {pending ? "Saving…" : "Save label"}
    </TkButton>
  )
}

export default function CompetitorLabelForm({
  competitorId,
  displayLabel,
  sourceName,
}: {
  competitorId: string
  displayLabel: string | null
  sourceName: string
}) {
  return (
    <form action={updateCompetitorDisplayLabelAction} className="tk-comp-labelform">
      <input type="hidden" name="competitor_id" value={competitorId} />
      <label htmlFor="comp-label" className="tk-comp-label-lbl">Display label</label>
      <input
        id="comp-label"
        name="display_label"
        type="text"
        defaultValue={displayLabel ?? ""}
        placeholder={sourceName}
        aria-describedby="comp-label-hint"
        className="tk-add-input"
        maxLength={120}
      />
      <p id="comp-label-hint" className="tk-comp-label-hint">
        Shown instead of “{sourceName}” (the name from Google) everywhere we show this
        competitor — handy to tell two same-named locations apart. Leave blank to use the original.
      </p>
      <div className="tk-comp-label-actions">
        <SubmitButton />
      </div>
    </form>
  )
}
