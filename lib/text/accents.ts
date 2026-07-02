// ALT-266: headlines may carry [[accent]] markup (rendered as the rust keyword
// accent by components/ticket/accentize.tsx). Every PLAIN-TEXT surface — email
// subjects/bodies, Ask context, logs — must strip it before display.
export function stripAccents(text: string): string {
  return text.replace(/\[\[|\]\]/g, "")
}
