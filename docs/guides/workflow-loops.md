---
title: "Repeat workflow steps"
description: "Choose a conditional loop, fixed repetition, or per-item workflow step."
---

Add repetition to a [working workflow](/code/guides/workflows) when a task must retry a refinement, poll for a result, or process a collection.

## Loops

Repeat steps based on conditions:

```ts
import { delay, doWhile, loop, map, step, times } from "veryfront/workflow";

// Repeat while condition is true
loop("refine", {
  while: (ctx) => ((ctx.review as { score?: number } | undefined)?.score ?? 0) < 0.9,
  steps: [
    step("rewrite", { agent: "writer" }),
    step("review", { agent: "reviewer" }),
  ],
});

// Execute once, then repeat until the condition is true
doWhile("poll", {
  until: (ctx) => Boolean((ctx.check as { done?: boolean } | undefined)?.done),
  steps: [
    step("check", { tool: "statusChecker" }),
    delay("wait", "5s"),
  ],
});

// Fixed iterations
times("generate", 3, [
  step("variant", { agent: "writer" }),
]);

// Map over array items
map("process", {
  items: (ctx) => (ctx.input as { urls: string[] }).urls,
  processor: step("scrape", { tool: "webScraper" }),
});
```

`loop` checks the condition before each iteration. `doWhile` runs the body once,
then repeats until its condition is true. `times` runs a fixed number of
iterations. `map` runs the processor once per item in an array.


## Verify it worked

Test an input that enters the loop and an input that stops it. Inspect node state and the final status. For a fixed repetition or collection, confirm the expected number of iterations. Set an overall workflow timeout when a condition depends on an external result that may never arrive.

## Related

- [Workflow configuration](/code/guides/workflows#workflow-configuration): Timeouts and retries.
