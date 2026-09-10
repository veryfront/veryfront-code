import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { recordDeniedToolExecution } from "../probe.ts";

export default tool({
  id: "denied",
  description: "Synthetic tool outside the invocation allowlist",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => {
    recordDeniedToolExecution();
    return { unexpected: true };
  },
});
