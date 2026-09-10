import { agent } from "veryfront/agent";
import { installHooks } from "../probe.ts";

export default agent({
  id: "coder",
  name: "Synthetic native coder",
  model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
  system: () => {
    installHooks();
    return "Inspect the authorized query.";
  },
  tools: { inspect: true },
  skills: false,
  maxSteps: 2,
});
