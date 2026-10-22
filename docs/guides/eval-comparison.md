---
title: "Compare eval runs and models"
description: "Detect regressions against a saved eval baseline and compare candidate model quality, cost, and latency."
order: 240
---

Compare the same evaluation across a change or model choice. Start with a [working eval](./evals.md) and a reviewed baseline report. Use stable dataset IDs so changed results can be matched to the same examples.

## Compare with a saved baseline

Use JSON mode for automation:

```bash
veryfront eval deep-research --json
```

Use a saved report as a CI baseline. The command exits with status `1` when the
current run introduces a regression against the baseline:

```bash
veryfront eval deep-research \
  --baseline .veryfront/evals/baseline.json \
  --report .veryfront/evals/current.json \
  --json
```

By default, `--baseline` fails on any aggregate pass-rate drop, failed-count
increase, metric pass-rate regression, or newly failing example. Use threshold
flags only for intentional tolerance:

```bash
veryfront eval deep-research \
  --baseline .veryfront/evals/baseline.json \
  --baseline-pass-rate-drop-threshold 0.02 \
  --baseline-metric-pass-rate-drop-threshold 0.02 \
  --baseline-usage-increase-threshold 0.15 \
  --baseline-latency-increase-threshold 0.2 \
  --json
```

Usage and p95 latency deltas are reported in `summary.json` whenever both the
current report and baseline include those values. They fail the run only when
the matching threshold flag is set. A baseline is accepted only for the same
eval definition and target; a report from another eval is rejected instead of
being compared.

Update the baseline explicitly after reviewing the current report:

```bash
veryfront eval deep-research \
  --write-baseline .veryfront/evals/baseline.json \
  --json
```

## Compare models

Compare candidate models against a baseline model when you want to lower cost
or latency without weakening quality:

```bash
veryfront eval deep-research \
  --baseline-model anthropic/claude-sonnet-4-6 \
  --candidate-model moonshotai/kimi-k2.6 \
  --report-dir .veryfront/evals/deep-research-models \
  --json
```

Model comparison runs the same eval once per model. It writes one report per
model under `models/<model-id>/`, plus `comparison.json` and `comparison.md` at
the report root. `comparison.json` keeps `baselineModel` and `candidateModels`
separate, then includes `models[]` for the per-model metric summaries. The
recommendation is conservative: a candidate is promoted only when it has no
failed runs, introduces no newly failed examples, satisfies the groundedness
threshold when measured, and improves cost, token use, or p95 latency. Otherwise
the comparison keeps the baseline or asks for review.

Gateway-backed runs add split input/output tokens, billable input/output tokens,
provider cost, Veryfront charge, credits, and cost source to the comparison
report. Direct local runs do not estimate prices in the framework; their cost
cells stay `not measured` unless a gateway supplies billing metadata.

## Set comparison criteria

Use a comparison policy when latency, cost, and quality tradeoffs depend on the
product. Constraints are hard gates. Objectives rank candidates that pass those
gates. Veryfront does not ship presets because each agent has different
requirements.

```json
{
  "constraints": {
    "gateFailures": { "max": 0 },
    "p95Ms": { "maxRegressionPct": 0.5 }
  },
  "objectives": {
    "totalTokens": { "weight": 0.8, "direction": "minimize" },
    "p95Ms": { "weight": 0.2, "direction": "minimize" }
  }
}
```

```bash
veryfront eval deep-research \
  --baseline-model anthropic/claude-sonnet-4-6 \
  --candidate-model moonshotai/kimi-k2.6 \
  --comparison-policy evals/model-comparison.policy.json \
  --report-dir .veryfront/evals/deep-research-models
```

Policy metrics can reference `passRate`, `failed`, `gateFailures`,
`groundednessScore`, `totalTokens`, `costUsd`, `costCredits`, and `p95Ms`.
`costUsd` remains a backward-compatible cost objective and prefers gateway
Veryfront charge when it is available. Use `min`, `max`, and
`maxRegressionPct` for constraints. Use `weight` with `direction` set to
`"minimize"` or `"maximize"` for objectives.

Each report includes provenance metadata. Local runs record git SHA, branch,
dirty state, and a dirty hash. Cloud runs prefer release, deployment, or preview
identity when those values are present.


## Verify the comparison

Inspect the baseline identity, dataset, and failed-example list before accepting the result. Keep the existing baseline when the new run regresses. Update it only after reviewing the change and its evidence.

## Related

- [Define evals](./evals.md): Datasets, metrics, and checks.
- [Export eval reports](./eval-reporting.md): External report destinations.
