import { datasets, evalAgent, metrics } from "veryfront/eval";

export default evalAgent({
  name: "Assistant smoke test",
  target: "agent:assistant",
  dataset: datasets.inline([
    {
      id: "calculator",
      input: "Use the calculator tool to multiply 24 by 7.",
      reference: "168",
    },
  ]),
  metrics: [
    metrics.answer.contains({ text: "168" }).gate(),
    metrics.agent.calledTool("calculator").gate(),
    metrics.agent.noFailedTools().gate(),
  ],
});
