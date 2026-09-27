# BudgetSight Insights Summary Generator

A dependency-free Node CLI that turns a BudgetSight `/api/insights` JSON response into a concise Markdown executive summary. It reports normalized turn outcomes, estimated spend and token volume, data-confidence warnings, and up to three ranked review signals.

## Use

From this directory, with Node.js 24 or newer:

```sh
node summary.js path/to/insights-response.json
```

Save the output if useful:

```sh
node summary.js path/to/insights-response.json > executive-summary.md
```

Try the included sample:

```sh
node summary.js fixture.json
```

The input should be a JSON object from the Insights endpoint with `summary` and optional `window`, `dataQuality`, and `opportunities` fields. Missing optional fields are handled safely. The tool writes errors to stderr and exits nonzero for unreadable, invalid, or unsupported input.

## Tests

```sh
npm test
```
