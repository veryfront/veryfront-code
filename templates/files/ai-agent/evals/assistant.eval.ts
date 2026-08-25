import { datasets, evalAgent, judges, metrics } from "veryfront/eval";

export default evalAgent({
  name: "Assistant smoke test",
  target: "agent:assistant",

  dataset: datasets.inline([
    {
      id: "calculator",
      input:
        "Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly.",
      reference:
        "The tip is $15.21 and the total is $99.71. Two people pay $33.24 and one pays $33.23.",
    },
  ]),

  metrics: [
    metrics.agent.calledTool("calculator").gate(),

    metrics.agent.noFailedTools().gate(),

    metrics.judge.rubric({
      rubric: [
        "The answer must state a tip of $15.21 and a total of $99.71.",
        "It must split the total into $33.24, $33.24, and $33.23.",
      ].join(" "),
      judge: judges.llm.rubric(),
    }).gate({ min: 0.8 }),
  ],
});
