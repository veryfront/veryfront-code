import { datasets, evalAgent, judges, metrics } from "veryfront/eval";

export default evalAgent({
  name: "Assistant smoke test",
  target: "agent:assistant",
  dataset: datasets.inline([
    {
      id: "calculator",
      input:
        "Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly.",
      reference: "$99.71 total; two people pay $33.24 and one pays $33.23.",
    },
  ]),
  metrics: [
    metrics.answer.regex({
      pattern: String.raw`(?<![-\d.\\])\\?\$15\.21(?!\d|\.\d)`,
    }).gate(),
    metrics.answer.regex({
      pattern: String.raw`(?<![-\d.\\])\\?\$99\.71(?!\d|\.\d)`,
    }).gate(),
    metrics.answer.regex({
      pattern: String.raw`(?<![-\d.\\])\\?\$33\.24(?!\d|\.\d)`,
    }).gate(),
    metrics.answer.regex({
      pattern: String.raw`(?<![-\d.\\])\\?\$33\.23(?!\d|\.\d)`,
    }).gate(),
    metrics.agent.calledTool("calculator").gate(),
    metrics.agent.noFailedTools().gate(),
    metrics.judge.rubric({
      rubric:
        "The answer must correctly state the $15.21 tip, $99.71 total, and a cent-exact split of two payments of $33.24 and one of $33.23. It should explain the result briefly.",
      judge: judges.llm.rubric(),
    }).gate({ min: 0.8 }),
  ],
});
