#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OUTCOMES = ["completed", "partial_completion", "failed", "unknown"];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const label = (value) => String(value).replaceAll("_", " ");
const count = (value) => new Intl.NumberFormat("en-US").format(value);
const dollars = (micros) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(micros / 1_000_000);

export function renderSummary(data) {
  if (!data || typeof data !== "object" || !data.summary || typeof data.summary !== "object") {
    throw new Error("Expected a BudgetSight Insights response with a summary object.");
  }
  const summary = data.summary;
  const outcomes = summary.outcomes || {};
  const turns = number(summary.turns);
  const completed = number(outcomes.completed);
  const incomplete = number(outcomes.partial_completion) + number(outcomes.failed);
  const unknown = number(outcomes.unknown);
  const completionRate = turns ? `${Math.round(completed / turns * 100)}%` : "—";
  const lines = [
    "# BudgetSight Insights — Executive Summary",
    "",
    `**Scope:** ${count(turns)} turns${data.window?.from ? ` · ${data.window.from.slice(0, 10)}` : ""}${data.window?.to ? ` to ${data.window.to.slice(0, 10)}` : ""}`,
    "",
    `Across **${count(turns)} turns**, estimated spend was **${dollars(number(summary.spendMicros))}** across **${count(number(summary.totalTokens))} tokens**. ${count(completed)} were completed (**${completionRate}**); ${count(incomplete)} were partial or failed, and ${count(unknown)} had unknown outcomes.`,
    "",
    "## Outcomes",
    "",
    ...OUTCOMES.map((outcome) => `- **${label(outcome)}:** ${count(number(outcomes[outcome]))}`),
  ];
  const quality = data.dataQuality || {};
  const warnings = [
    ["unknownOutcomes", "unknown outcome"],
    ["missingUsage", "turn missing usage data"],
    ["incompleteSources", "turn with incomplete source data"],
    ["pendingExtraction", "turn awaiting semantic extraction"],
    ["failedExtraction", "turn with failed semantic extraction"],
  ].flatMap(([key, description]) => number(quality[key]) > 0 ? [`${count(number(quality[key]))} ${description}${number(quality[key]) === 1 ? "" : "s"}`] : []);
  lines.push("", "## Data confidence", "", warnings.length
    ? `- **Review before drawing broad conclusions:** ${warnings.join("; ")}.`
    : "- No data-quality issues were reported for this scope.");
  const highlights = (data.opportunities || []).filter((item) => item.type !== "data_confidence").slice(0, 3);
  if (highlights.length) {
    lines.push("", "## Signals to review", "", ...highlights.map((item) => `- **${item.title}** — ${item.summary}`));
  }
  lines.push("", "_Spend is an API-rate estimate; outcomes and semantic labels reflect available reporting evidence._");
  return lines.join("\n");
}

async function main() {
  const filename = process.argv[2];
  if (!filename || process.argv.length > 3) {
    console.error("Usage: node summary.js <insights-response.json>");
    process.exitCode = 2;
    return;
  }
  try {
    const data = JSON.parse(await readFile(filename, "utf8"));
    console.log(renderSummary(data));
  } catch (error) {
    console.error(`Could not summarize Insights response: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
