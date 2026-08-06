import { datasets, evalAgent, judges, metrics } from "veryfront/eval";

// An eval runs your agent against fixed inputs and grades the results.
// This one asks the assistant a single arithmetic question, then checks that it
// used the calculator, that no tool errored, and that the answer is correct.
//
// Run it with: npm run eval -- assistant
export default evalAgent({
  name: "Assistant smoke test",
  target: "agent:assistant",

  // The questions to ask. `reference` is the answer you expect; the judge below
  // grades the agent's answer against it.
  dataset: datasets.inline([
    {
      id: "calculator",
      input:
        "Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly.",
      reference:
        "The tip is $15.21 and the total is $99.71. Two people pay $33.24 and one pays $33.23.",
    },
  ]),

  // Each metric is a gate: if any one fails, the eval fails.
  metrics: [
    // The agent must do the arithmetic with the calculator tool, not in its head.
    metrics.agent.calledTool("calculator").gate(),

    // No tool call may error.
    metrics.agent.noFailedTools().gate(),

    // A second model reads the answer and scores it from 0 to 1 against this
    // rubric. It needs at least 0.8 to pass.
    metrics.judge.rubric({
      rubric: [
        "The answer must state a tip of $15.21 and a total of $99.71.",
        "It must split the total into $33.24, $33.24, and $33.23.",
        "Every amount must be exact to the cent: $33.2366 and $133.23 are wrong.",
        "The explanation must be brief.",
      ].join(" "),
      judge: judges.llm.rubric(),
    }).gate({ min: 0.8 }),
  ],
});
