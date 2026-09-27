import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderSummary } from "./summary.js";

const fixture = JSON.parse(await readFile(new URL("./fixture.json", import.meta.url), "utf8"));

test("summarizes outcomes, spend, scope, and a useful signal", () => {
  const output = renderSummary(fixture);
  assert.match(output, /12 turns/);
  assert.match(output, /\$2\.84/);
  assert.match(output, /completed.*8/);
  assert.match(output, /partial completion.*2/);
  assert.match(output, /67%/);
  assert.match(output, /Edits often finish without final validation/);
});

test("warns on data-confidence issues and omits clean categories", () => {
  const output = renderSummary(fixture);
  assert.match(output, /Review before drawing broad conclusions/);
  assert.match(output, /unknown outcome/);
  assert.match(output, /missing usage data/);
  assert.match(output, /awaiting semantic extraction/);
  assert.doesNotMatch(output, /incomplete source data/);
});

test("reports a clean confidence state when no quality issues are present", () => {
  const output = renderSummary({ summary: { turns: 0, outcomes: {} }, dataQuality: {} });
  assert.match(output, /No data-quality issues were reported/);
  assert.match(output, /—/);
});
