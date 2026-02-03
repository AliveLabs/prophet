/**
 * Business insight system: inputs business name, type, and location,
 * queries Gemini for competitors, events, weather, sentiment, and
 * aggregates into actionable insight. Supports 1d, 7d, 30d time windows.
 */

import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  buildBusinessInsightPrompt,
  buildBusinessInsightPromptCompact,
  type PromptVariant,
} from "./build-business-insight-prompt.js";
import {
  type BusinessInsightInput,
  type BusinessInsightResponse,
  type TimeRange,
  BUSINESS_INSIGHT_RESPONSE_JSON_SCHEMA,
} from "./business-insight-types.js";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const DEFAULT_MODEL = "gemini-flash-latest";
const VALID_TIME_RANGES: TimeRange[] = ["1d", "7d", "30d"];

function parseTimeRange(s: string): TimeRange {
  const v = s.toLowerCase();
  if (VALID_TIME_RANGES.includes(v as TimeRange)) return v as TimeRange;
  if (s === "1" || s === "1day") return "1d";
  if (s === "7" || s === "7days") return "7d";
  if (s === "30" || s === "30days") return "30d";
  return "7d";
}

/**
 * Parses CLI args into BusinessInsightInput, TimeRange, and compact flag.
 * Usage: ... [--org Org] [--time 7d] [--compact] <businessName> <businessType> <address>
 */
function parseArgs(args: string[]): {
  input: BusinessInsightInput;
  timeRange: TimeRange;
  compact: boolean;
} {
  const input: BusinessInsightInput = {
    businessName: "",
    businessType: "",
    address: "",
  };
  let timeRange: TimeRange = "7d";
  let compact = false;
  const positionals: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--org" && args[i + 1]) {
      input.organizationName = args[++i];
      i++;
      continue;
    }
    if (args[i] === "--time" && args[i + 1]) {
      timeRange = parseTimeRange(args[++i]);
      i++;
      continue;
    }
    if (args[i] === "--compact") {
      compact = true;
      i++;
      continue;
    }
    if (args[i].startsWith("--")) {
      i++;
      continue;
    }
    positionals.push(args[i]);
    i++;
  }
  if (positionals.length >= 1) input.businessName = positionals[0];
  if (positionals.length >= 2) input.businessType = positionals[1];
  if (positionals.length >= 3) input.address = positionals[2];
  return { input, timeRange, compact };
}

/**
 * Extracts JSON from model response (may be wrapped in markdown code fence).
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.startsWith("```") ? trimmed.slice(0, 3) : null;
  if (fence) {
    const start = trimmed.indexOf("\n");
    const end = trimmed.lastIndexOf(fence);
    if (start !== -1 && end > start) return trimmed.slice(start + 1, end).trim();
  }
  return trimmed;
}

/**
 * Fetches business insight from Gemini and returns parsed response.
 * One API call per run — quota issues are from token volume (large prompt + output), not multiple requests.
 */
export async function fetchBusinessInsight(
  input: BusinessInsightInput,
  timeRange: TimeRange,
  options?: {
    model?: string;
    maxOutputTokens?: number;
    promptVariant?: PromptVariant;
  }
): Promise<BusinessInsightResponse> {
  const model = options?.model ?? DEFAULT_MODEL;
  const envMax = process.env.MAX_OUTPUT_TOKENS
    ? parseInt(process.env.MAX_OUTPUT_TOKENS, 10)
    : NaN;
  const maxOutputTokens =
    options?.maxOutputTokens ?? (Number.isFinite(envMax) ? envMax : 4096);
  const variant =
    options?.promptVariant ??
    (process.env.PROMPT_VARIANT === "compact" ? "compact" : "full");
  const prompt =
    variant === "compact"
      ? buildBusinessInsightPromptCompact(input, timeRange)
      : buildBusinessInsightPrompt(input, timeRange);
  console.log(prompt);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: BUSINESS_INSIGHT_RESPONSE_JSON_SCHEMA,
      maxOutputTokens,
      temperature: 0.4,
    },
  });

  const raw = response.text ?? "";
  const jsonStr = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      "Gemini did not return valid JSON. Raw response:\n" + raw.slice(0, 500)
    );
  }

  return parsed as BusinessInsightResponse;
}

/**
 * Prints a formatted summary of the insight to stdout.
 */
export function printInsight(insight: BusinessInsightResponse): void {
  const { requestContext, competitors, localEvents, weather, sentiment, actionableInsight } =
    insight;

  console.log("\n--- Business Insight Report ---\n");
  console.log(`Business: ${requestContext.businessName} (${requestContext.businessType})`);
  console.log(`Location: ${requestContext.location}`);
  console.log(`Time range: ${requestContext.timeRange} (generated: ${requestContext.generatedAt})\n`);

  console.log("## Competitors (up to 10)");
  competitors.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} — ${c.businessType}`);
    console.log(`     ${c.address}`);
    console.log(`     ${c.description}`);
    if (c.strengths?.length) console.log(`     Strengths: ${c.strengths.join("; ")}`);
    if (c.weaknesses?.length) console.log(`     Weaknesses: ${c.weaknesses.join("; ")}`);
  });

  console.log("\n## Local events (up to 10)");
  localEvents.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.name} — ${e.date} @ ${e.venue}`);
    console.log(`     Type: ${e.eventType}. Relevance: ${e.relevanceToBusiness}`);
    if (e.opportunity) console.log(`     Opportunity: ${e.opportunity}`);
  });

  console.log("\n## Weather");
  console.log(`  Current: ${weather.currentConditions}`);
  if (weather.temperature) console.log(`  Temperature: ${weather.temperature}`);
  console.log(`  Forecast: ${weather.forecastSummary}`);
  console.log(`  Impact: ${weather.impactOnBusiness}`);
  if (weather.recommendation) console.log(`  Recommendation: ${weather.recommendation}`);

  console.log("\n## Sentiment");
  console.log("  Your business:", sentiment.yourBusiness.overallSentiment);
  console.log("  Score:", sentiment.yourBusiness.sentimentScore, "/ 100");
  console.log("  Summary:", sentiment.yourBusiness.reviewSummary);
  console.log("  Themes:", sentiment.yourBusiness.commonThemes.join(", "));
  sentiment.competitors.forEach((s) => {
    console.log(`  Competitor ${s.businessName}: ${s.overallSentiment} (${s.sentimentScore}) — ${s.reviewSummary}`);
  });

  console.log("\n## Actionable insight");
  console.log("  Executive summary:", actionableInsight.executiveSummary);
  console.log("  Priorities:", actionableInsight.priorities.join(" | "));
  console.log("  Opportunities:", actionableInsight.opportunities.join(" | "));
  console.log("  Risks:", actionableInsight.risks.join(" | "));
  console.log("  Recommended actions:", actionableInsight.recommendedActions.join(" | "));
  console.log("  Competitive position:", actionableInsight.competitivePosition);
  console.log("  Next steps:", actionableInsight.nextSteps.join(" | "));
  console.log("\n--- End report ---\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { input, timeRange, compact } = parseArgs(args);

  if (!input.businessName || !input.businessType || !input.address) {
    console.error(
      "Usage: npm run insight -- [--org Organization] [--time 1d|7d|30d] [--compact] <businessName> <businessType> <address>"
    );
    console.error(
      "Example: npm run insight -- \"Joe's Cafe\" \"coffee shop\" \"300 W Campbell Rd, Richardson, TX 75080\" --time 7d"
    );
    console.error("  --compact  use smaller prompt (~2048 token target) for quota testing");
    process.exit(1);
  }

  if (!process.env.GOOGLE_API_KEY) {
    console.error("Set GOOGLE_API_KEY in .env");
    process.exit(1);
  }

  try {
    if (compact) console.log("Using compact prompt (~2048 token target).\n");
    const insight = await fetchBusinessInsight(input, timeRange, {
      promptVariant: compact ? "compact" : "full",
    });
    printInsight(insight);
    // Optionally write full JSON to file
    if (process.env.OUTPUT_JSON_PATH) {
      const fs = await import("fs/promises");
      await fs.writeFile(
        process.env.OUTPUT_JSON_PATH,
        JSON.stringify(insight, null, 2),
        "utf-8"
      );
      console.log("Full JSON written to", process.env.OUTPUT_JSON_PATH);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
