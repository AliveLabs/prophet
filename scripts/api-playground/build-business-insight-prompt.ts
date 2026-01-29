/**
 * Builds a robust, specific prompt and request payload for Gemini
 * to produce structured business insight (competitors, events, weather, sentiment).
 */

import type { BusinessInsightInput, TimeRange } from "./business-insight-types.js";

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "1d": "the last 1 day (24 hours)",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

/**
 * Builds the full location string from address and optional city/state/postalCode.
 */
function formatLocation(input: BusinessInsightInput): string {
  const parts = [input.address];
  if (input.city) parts.push(input.city);
  if (input.state) parts.push(input.state);
  if (input.postalCode) parts.push(input.postalCode);
  return parts.filter(Boolean).join(", ");
}

/**
 * Builds the structured request object we send to Gemini (in the prompt)
 * so the model has a clear, parseable context.
 */
export function buildStructuredRequestPayload(
  input: BusinessInsightInput,
  timeRange: TimeRange
): object {
  const location = formatLocation(input);
  return {
    request: {
      organizationName: input.organizationName ?? null,
      businessName: input.businessName,
      businessType: input.businessType,
      location,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      timeRange,
      timeWindowDescription: TIME_RANGE_LABELS[timeRange],
    },
    instructions: {
      competitors: "Identify up to 10 direct or indirect competitors in the same area. Include name, type, address, brief description, and if possible strengths/weaknesses.",
      localEvents: "Identify up to 10 local events (festivals, markets, conferences, community events) in the area within the time window that could affect foot traffic or demand.",
      weather: "Provide current and near-term weather for the location and how it may impact the business (e.g. outdoor seating, delivery, foot traffic).",
      sentiment: "Summarize review and social media sentiment for the business and for each competitor over the time window. Include overall sentiment, score 0-100, themes, and sample quotes where relevant.",
      actionableInsight: "Synthesize all of the above into actionable business insight: executive summary, ordered priorities, opportunities, risks, recommended actions, competitive position, and next steps.",
    },
  };
}

/**
 * Builds the full prompt text for Gemini.
 * Explicit and specific so the model returns valid JSON matching our schema.
 */
export function buildBusinessInsightPrompt(
  input: BusinessInsightInput,
  timeRange: TimeRange
): string {
  const location = formatLocation(input);
  const timeWindow = TIME_RANGE_LABELS[timeRange];
  const payload = buildStructuredRequestPayload(input, timeRange);

  return `You are a business intelligence analyst. Your task is to produce a structured business insight report for a local business.

## Structured request (use this exactly for context)
\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## Business context
- **Business name:** ${input.businessName}
${input.organizationName ? `- **Organization / brand:** ${input.organizationName}` : ""}
- **Business type:** ${input.businessType}
- **Location / address:** ${location}
- **Time window to analyze:** ${timeWindow}

## Your tasks (be specific and use real or plausible data for the location)

1. **Competitors (up to 10)**  
   Identify direct and indirect competitors in the area. For each: name, business type, address (or area), short description, and if possible strengths and weaknesses. Prefer real or plausible local businesses for this location.

2. **Local events (up to 10)**  
   List local events in the area within ${timeWindow} that could affect the business (foot traffic, demand, partnerships). Include: event name, date, venue, type, relevance to the business, and any opportunity (e.g. "consider a pop-up" or "promote delivery during event").

3. **Local weather**  
   Provide current and near-term weather for ${location}. Include: current conditions, temperature if known, forecast summary, impact on this type of business, and a short recommendation.

4. **Reviews and social media sentiment**  
   For the business "${input.businessName}" and for each competitor you listed:
   - Summarize review and social media sentiment over ${timeWindow}.
   - Give overall sentiment (positive / neutral / negative / mixed), a sentiment score from 0 (worst) to 100 (best), a short summary, common themes, and 1–3 sample quotes if plausible.
   Use realistic or plausible sentiment based on the business type and location; if you do not have real data, infer reasonable patterns.

5. **Actionable business insight**  
   Synthesize everything above into one coherent report:
   - **executiveSummary:** 2–4 sentences.
   - **priorities:** Ordered list of 3–5 priorities.
   - **opportunities:** List of concrete opportunities.
   - **risks:** List of risks to monitor.
   - **recommendedActions:** Specific, actionable steps.
   - **competitivePosition:** Short paragraph on how this business compares.
   - **nextSteps:** Suggested next steps (e.g. "monitor competitor X", "engage with event Y").

## Output format
Respond with a single JSON object only. No markdown, no code fence, no extra text before or after. The JSON must match this structure exactly:
- requestContext: { businessName, businessType, location, timeRange, generatedAt (ISO date string) }
- competitors: array of up to 10 objects with name, businessType, address, description, optional estimatedDistance, strengths, weaknesses
- localEvents: array of up to 10 objects with name, date, venue, eventType, relevanceToBusiness, optional opportunity
- weather: { currentConditions, optional temperature, forecastSummary, impactOnBusiness, optional recommendation }
- sentiment: { yourBusiness: one SentimentSummary, competitors: array of SentimentSummary } where each has businessName, overallSentiment, sentimentScore (0-100), reviewSummary, optional socialMediaSummary, commonThemes, optional sampleQuotes, timeWindow }
- actionableInsight: { executiveSummary, priorities, opportunities, risks, recommendedActions, competitivePosition, nextSteps }

Use "generatedAt": "${new Date().toISOString()}" in requestContext.`;
}
