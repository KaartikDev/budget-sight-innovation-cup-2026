# BudgetSight positioning audit

## Positioning snapshot

- **Core audience:** Engineering leads and teams running Codex through the local app-server who need visibility into agent work, spend, and outcomes across people and repositories.
- **Problem:** Agent work can consume tokens and hosted-tool calls without a clear per-thread boundary, while activity and results are hard to inspect consistently across runs.
- **Promise:** Set an estimated dollar cap before work starts, follow a thread’s activity and usage as it runs, and review normalized, privacy-conscious evidence about completed work—all in a local-first workspace.
- **Proof points:** Choose a repository, model, and cap before creating a thread; see live estimated spend, token and hosted-search usage, and account rate-limit metadata; interrupt at the cap (best-effort, since usage can arrive asynchronously); inspect Git context, events, outcomes, and exports; explore cross-run spend, workload, outcomes, and coordination patterns in admin Insights. Reporting stores normalized metadata and hashes rather than raw prompts, assistant messages, full commands, or command output.

## Copy read

The UI’s strongest hook is **“Give every agent a budget.”** It is direct and memorable, and the cap setup plus thread monitor make it tangible. The README provides useful credibility and implementation detail, but leads with “local-first product UI and audit layer”—language that describes the system more than the value. “Every token, command, and outcome” also overstates the clarity of the live experience: cost is an estimate, some usage arrives late, and complete raw events are available through export. Lead with budget control and work visibility; move pricing mechanics, runtime requirements, and caveats into supporting copy.

## Sharper headline options

1. **Put a clear spending limit on every Codex run.**
2. **See what your Codex agents spend—and what they get done.**
3. **Give every Codex task a budget, a paper trail, and a result.**
4. **Keep agent work visible from first prompt to final change.**
5. **Run Codex with spend limits and evidence you can inspect.**

**Recommended lead:** Option 2 for the broad product story; pair it with “Set an estimated dollar cap before a run, then inspect usage, activity, and outcomes in one local workspace.”

## Recommended demo narrative

1. **Set the boundary:** Start a thread, choose a repository and model, and set a modest cap. Explain that the cap uses estimated Standard API pricing and is best-effort because usage can arrive asynchronously.
2. **Make the work legible:** Submit a small, realistic task. While it runs, point to the thread timeline and monitor: activity, token and hosted-search usage, estimated spend, and the cap response.
3. **Show the receipt:** Open the completed thread and connect the outcome to its repository/branch context, activity, and session export. Call out what can be reviewed without implying the live UI exposes every raw event.
4. **Zoom out:** Switch to admin Insights to show spend over time, run efficiency, workload outcomes, or agent overlap. Close on the practical payoff: budget discipline for an individual run and evidence for improving team-wide agent workflows.

**Demo guardrail:** Describe dollar values as estimates, not invoices or guaranteed hard stops. The README explicitly excludes several pricing adjustments and notes that asynchronous usage can cause an overrun.
