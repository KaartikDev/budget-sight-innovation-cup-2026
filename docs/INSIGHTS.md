# Insights

The **Insights** page is an admin-only operating view of the current reporting rows in BudgetSight. It helps answer three questions:

1. Where are tokens, tool calls, time, and estimated spend accumulating?
2. Which execution or coordination patterns are worth reviewing?
3. How much confidence should we place in the conclusions?

The page is available at `/insights` to administrator accounts. It reports normalized turn data; it does not expose raw prompts, assistant messages, full commands, or command output.

## Start with the scope

The controls at the top determine which turns are included in every metric and chart.

### Date range

- **24 hours** uses hourly buckets.
- **7 days** uses daily buckets and is the default.
- **30 days** uses daily buckets.
- **All time** uses weekly buckets.

Empty buckets inside the selected date window remain visible in the time-series chart. This makes quiet periods distinguishable from missing chart data.

### Filters

You can narrow the selected window by:

- repository
- user
- model
- workload
- outcome

The counts shown beside filter options describe the available rows in the selected date window before that particular filter is applied. Changing a filter reloads the aggregate view and clears any chart selection.

The **Updated** timestamp indicates when the response was generated. It is not a promise that every event has already been projected into a reporting row; use the data-confidence strip to check for reporting gaps.

## What “normalized” means

The Insights page does not compare free-form descriptions such as “it mostly worked,” “the agent succeeded,” or “some files were changed.” Each turn is mapped to a small, controlled vocabulary. This is the **normalized taxonomy**: consistent labels that make turns comparable across users, repositories, models, and time windows.

Normalization improves aggregation and filtering, but it is still a classification. The labels summarize the available evidence; they do not replace reviewing the linked turn.

### Turn outcomes

Use these terms when describing whether the requested goal was delivered:

| Normalized label | Plain-language meaning |
| --- | --- |
| `completed` | The requested goal was delivered based on the available evidence. Prefer “completed” in reports and UI copy; `success` is not a turn-outcome label. |
| `partial_completion` | Only part of the requested goal was delivered. In plain language, say “partially completed” or “partial completion,” not “success.” |
| `failed` | The requested goal was not delivered. A failed turn may still contain useful diagnosis or partial work, but the requested result was not achieved. |
| `unknown` | There is not enough trustworthy evidence to decide whether the goal was delivered. Unknown is different from failed. |

The page’s **Incomplete spend** metric includes `partial_completion` and `failed` turns. It does not include `unknown` turns because unknown is a data-confidence problem, not a conclusion that the work failed.

### Outcome, tool status, and validation are different

These concepts should not be used interchangeably:

- **Turn outcome** answers: “Was the requested goal delivered?” (`completed`, `partial_completion`, `failed`, or `unknown`).
- **Tool status** answers: “Did an individual tool call finish successfully?” A tool can be completed while the overall turn is partial or failed. Conversely, a turn can be completed even if it used no tool calls.
- **Validation** answers: “Was the result verified?” The normalized validation states are `passed`, `failed`, `attempted`, `none`, and `unknown`.

For example, a turn can be `completed` with validation `none` when the requested change was delivered but no test or build evidence was recorded. That is why the page treats outcome and validation as separate signals.

### Workload taxonomy

The primary workload describes what kind of work the turn mainly performed. A turn may also have up to two secondary workload labels.

| Label | Meaning |
| --- | --- |
| `code_generation` | Creates or changes implementation code. |
| `debugging` | Diagnoses or fixes a defect. |
| `testing` | Primarily creates or runs tests. |
| `repo_exploration` | Maps or develops an understanding of a repository. |
| `web_research` | Gathers information from the web. |
| `artifact_generation` | Creates documents, media, reports, or other artifacts. |
| `environment_setup` | Installs or configures dependencies or the runtime environment. |
| `deployment_operations` | Ships, deploys, or operates a service. |
| `analysis_planning` | Produces analysis or a plan without another primary deliverable. |
| `other` | Work that does not fit the defined categories. |
| `unknown` | Not enough evidence to classify the workload. |

Tool calls are normalized separately into intents such as `file_reading`, `code_search`, `code_editing`, `test_validation`, `command_execution`, `web_searching`, `version_control`, and `dependency_setup`. The heatmap uses these tool-intent labels, while the workload chart uses the workload labels above.

## How the Insights are generated

The page is built from reporting rows rather than directly from the live conversation. The flow is:

1. **Capture the turn.** BudgetSight records the turn boundary, timing, token usage, estimated cost, tool calls, repository snapshots, file changes, command results, and validation activity. Sensitive content is redacted or represented by hashes in reporting data.
2. **Build a deterministic draft.** Rules identify facts that can be measured reliably, including changed files, repeated commands, failed commands, timeouts, failure fingerprints, tool effects, and whether validation happened after the last modification. The draft starts with semantic status `pending`.
3. **Classify semantic features.** The local feature extractor reviews a reduced, evidence-linked representation of the turn and assigns the controlled workload, tool-intent, failure, outcome, and validation labels. It is instructed to describe what happened, not to decide whether the work was wasteful or what action to take.
4. **Validate and normalize.** The result is checked against the feature schema. Evidence references that do not belong to the turn are removed. Outcome and validation claims are reconciled with the deterministic tool evidence; for example, a non-unknown outcome without evidence of a result is downgraded to `unknown`.
5. **Persist the current row.** A draft row is stored while extraction is pending. A successful extraction replaces it with a `ready` final row. If extraction ultimately fails, a degraded row remains visible and the failure appears in Data confidence. Historical row versions are immutable; the Insights endpoint uses the current version for each turn.
6. **Aggregate the selected rows.** The reporting service applies the date and categorical filters, then calculates summary totals, time buckets, run points, repository-intent overlap, workload outcome proportions, data-quality counts, and ranked opportunities.
7. **Render linked evidence.** Every chart mark and opportunity keeps the IDs of its contributing turns. Clicking a mark uses those IDs to show the underlying turns, so an aggregate pattern can be checked against concrete evidence.

If the local semantic extractor is unavailable, deterministic draft rows still exist. They can support basic measured telemetry, but their semantic labels may be `unknown`, and the page will show the extraction issue in the data-confidence strip.

## Why these insights matter

The value of the page is not just displaying more telemetry. It turns individual agent activity into comparable operating signals:

- **Normalized outcomes make delivery visible.** Separating completed, partial, failed, and unknown turns prevents a binary “success/failure” view from hiding unfinished work or missing evidence. This lets teams compare delivery quality and the spend attached to incomplete work.
- **Normalized workloads make like-for-like comparisons possible.** A debugging turn should not be judged by the same baseline as a repository-exploration turn. Workload groups let you compare outcomes, token use, and efficiency within a meaningful class of work.
- **Time-series trends show when cost pressure begins.** A single expensive turn may be justified; repeated spikes suggest a workflow, context, model, or coordination pattern worth investigating.
- **The efficiency scatterplot finds review candidates.** Combining duration, spend, tool activity, and outcome helps surface slow or costly runs without claiming that every outlier is waste.
- **Overlap reveals coordination load.** When multiple agents repeatedly touch the same repository-intent area, the organization may be paying for duplicated exploration, handoff friction, or intentional collaboration. The signal tells you where to ask the question.
- **Outcome-by-workload exposes reliability differences.** If a workload has many partial or failed turns, the next step may be better task framing, setup, validation, or recovery—not simply reducing token use.
- **Opportunities turn patterns into decisions.** The opportunity feed ranks recurring, evidence-backed patterns so review can start with the largest or most actionable signals. Measured findings describe what happened; estimated findings suggest a hypothesis to validate.
- **Data confidence prevents false certainty.** Missing usage, incomplete sources, unknown outcomes, and unfinished extraction are surfaced so aggregate results are not mistaken for complete truth.

## Summary metrics

The metric tape is a quick read of the selected population.

| Metric | Meaning | How to interpret it |
| --- | --- | --- |
| **Measured spend** | Sum of each selected turn’s estimated cost, shown in USD. | Use it to compare relative cost inside BudgetSight. It is an API-rate estimate, not a ChatGPT subscription invoice. |
| **Total tokens** | Sum of input and output tokens recorded for the selected turns. | A large value indicates context or generation volume; pair it with outcomes and duration before calling it waste. |
| **Prompt cache** | Cached input tokens divided by all input tokens. | Higher is usually favorable for repeated context, but a high cache rate does not prove that the underlying work was useful or successful. |
| **Incomplete spend** | Spend from `partial_completion` and `failed` turns only. | Review this alongside the number of affected turns and their evidence. `unknown` outcomes are not included here. |
| **Completed** | Number of turns whose normalized outcome is `completed`. | Compare this with the total analyzed turns; a completion count alone is not a completion rate. |

BudgetSight estimates spend using Standard OpenAI API-key rates, including cached-input pricing and eligible hosted-tool fees. See the [budget behavior documentation](../README.md#budget-behavior) for pricing assumptions and exclusions.

## Reading the charts

### Cost pressure and token composition

This chart combines two views on the same time axis:

- The stepped **spend line** shows estimated spend per time bucket.
- The stacked bars show **cached input**, **uncached input**, and **output** tokens.

The spend line and token bars use separate vertical scales. Do not compare the height of a spend line with the height of a token segment as if they were the same unit. Instead, look for patterns such as:

- spend spikes that coincide with output-token spikes;
- large uncached-input periods that may indicate repeated or growing context;
- high token volume without a corresponding rise in successful outcomes;
- repeated spend spikes in the same workload or repository after applying a filter.

Click a bucket to inspect the turns contributing to it.

### Where execution gets expensive

The scatterplot places one turn at:

- **x-axis:** duration;
- **y-axis:** estimated spend;
- **circle size:** number of tool calls;
- **color:** normalized outcome.

The median duration and median spend lines divide the plot into relative quadrants. A point above and to the right of both lines is expensive and slow relative to the selected population; it is a review candidate, not automatically a problem. A large circle can indicate tool-heavy work, but tool count by itself does not show that the calls were avoidable.

Use the outcome colors and the selected turn details together. A high-spend completed turn may be legitimate, while a low-spend failed turn may still reveal a reliability issue. If duration was not recorded, the detail view shows **Not recorded**; treat its horizontal position as incomplete evidence.

Click a point to open its evidence.

### Where agents repeat classes of work

The overlap heatmap groups tool calls by **repository** and normalized **tool intent**.

- Each cell’s number is the total call count.
- Cell intensity represents the number of distinct agents/users represented in that repository-intent area.
- A darker cell therefore means broader participation, not necessarily more calls.

The page shows the busiest repositories and intents first so the chart stays readable. Click a cell to see the participating agents, call count, turn count, and linked turns.

Overlap is a coordination signal. It may be intentional collaboration, shared maintenance, or duplicated exploration. It is not proof of cache waste or duplicated work.

### Outcomes by workload

Each row groups turns by the normalized workload taxonomy, such as `code_generation`, `debugging`, `testing`, or `repo_exploration`. The stacked segments show the proportion of:

- **Completed**
- **Partial completion**
- **Failed**
- **Unknown**

The row label includes the number of turns in the group. Rows with fewer than three turns are visually marked as low-sample; use them for orientation only. Click a segment to inspect the turns behind that outcome.

The outcome chart describes association, not causation. A workload may have a low completion share because it is inherently difficult, because its inputs are incomplete, or because extraction has not finished.

## Evidence worth acting on

The opportunity feed is a ranked list of up to eight signals. The ranking is a prioritization heuristic based on the strength and size of the observed pattern; it is not a financial forecast.

Each opportunity includes:

- a confidence label, currently **high** or **medium**;
- an impact type: **measured** or **estimated**;
- a short evidence summary;
- a sparkline showing how the linked turns are distributed across the selected time buckets.

### Opportunity types

The current rules produce these signals:

| Signal | When it appears | What to do with it |
| --- | --- | --- |
| **Incomplete runs hold a large share of spend** | Partial or failed turns consume measurable spend. The signal receives higher priority when they account for at least 40% of spend. | Inspect the linked turns, then separate legitimate retries from avoidable failure or unclear task boundaries. |
| **Edits often finish without final validation** | A turn changed files but no validation was recorded after the last modification. | Check whether a test, build, lint, or other validation should have been run before completion. |
| **Repeated and failed commands add execution churn** | Exact command repeats, failed commands, or timeouts were observed. | Look for an unstable command, missing prerequisite, or a recovery loop. |
| **The same failures recur across turns** | The same deterministic failure fingerprint appears in more than one turn for a repository. | Treat the recurring category as a candidate for a durable fix or better setup. |
| **Stable read-only results may be reusable** | The same read-only tool/input pattern returns the same output across turns. | Consider reuse or caching only after confirming the repository state and freshness requirements. The potential context avoided is an estimate. |
| **Agents repeat the same classes of repository work** | More than one agent appears in a repository-intent heatmap cell. | Check for intentional collaboration before changing ownership or caching behavior. |
| **[Workload] has an incomplete-run efficiency gap** | A workload has at least three completed and three partial/failed samples, and the incomplete median uses at least 1.5× the tokens of the completed median. | Compare the linked turns for task ambiguity, retries, context growth, or missing validation. |
| **Some turns limit confidence in aggregate conclusions** | Unknown outcomes, missing usage, incomplete source capture, pending extraction, or failed extraction are present. | Resolve data quality before making broad optimization claims. |

Measured impact is calculated from recorded rows, such as spend, calls, turns, or events. Estimated impact is modeled from observed output size or token ratios and should be validated before being treated as savings.

## Data confidence

The strip at the bottom summarizes reporting-quality signals for the selected population:

- **Unknown outcomes:** the turn did not resolve to a known outcome.
- **Missing usage:** token usage is unavailable for the turn. It is not evidence of zero usage.
- **Incomplete sources:** the source event set used to build the row is incomplete.
- **Pending extraction:** semantic feature extraction has not finished.
- **Failed extraction:** semantic feature extraction failed for the row.

If the strip says **Reporting inputs are complete**, none of these signals were found in the selected rows. That improves confidence in the aggregates, but it does not make the findings causal or guarantee that a high-cost turn was inefficient.

## Explore linked evidence

Most marks in the charts and every opportunity row are interactive. Selecting one displays a chip and opens the **Selected evidence** rail. The rail shows:

- the number of linked turns;
- total estimated spend for those turns;
- total tool calls;
- up to 20 linked turns, ordered by spend descending;
- repository, user, workload, outcome, duration, and per-turn spend.

Use the rail to move from an aggregate pattern to concrete turns. Clear the selection with the close button or the selection chip. A selection is cleared automatically when the filters or date range change.

## Recommended review workflow

1. Choose a time range that contains enough turns to compare.
2. Check the data-confidence strip before trusting aggregate conclusions.
3. Scan measured spend, incomplete spend, and completed turns together.
4. Use the time series to locate spikes, then filter by repository, workload, model, or outcome.
5. Open the highest-priority opportunity and inspect its linked turns.
6. Compare the scatterplot and workload outcomes to distinguish isolated expensive work from a recurring pattern.
7. Treat estimated impacts as hypotheses and verify them with a controlled workflow change.

## Important limitations

- Spend is an estimate based on Standard API-key pricing and is not a billing statement.
- Reporting rows are normalized summaries; the page intentionally does not show raw prompts or full command output.
- A correlation between cost, duration, tool activity, and outcome does not establish causation.
- Small samples can produce unstable percentages and medians.
- “Overlap” means multiple agents touched the same repository-intent category; it does not prove duplicated work.
- A completed turn can still be inefficient, and an incomplete turn can be legitimate.
- Semantic workload and outcome labels depend on the feature-extraction pipeline; pending or failed extraction is surfaced as a confidence signal.
