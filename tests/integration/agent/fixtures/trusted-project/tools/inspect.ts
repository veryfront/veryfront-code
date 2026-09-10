import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { observations } from "../probe.ts";
import process from "node:process";

export default tool({
  id: "inspect",
  description: "Inspect a synthetic query",
  inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
  execute: async (input, context) => {
    const globals = globalThis as typeof globalThis & { __vfNativeCalls?: number };
    globals.__vfNativeCalls = (globals.__vfNativeCalls ?? 0) + 1;
    if (input.query === "crash") process.exit(23);
    if (input.query === "wait") {
      await context?.publishDataEvent?.({ type: "fixture.waiting" });
      await new Promise<void>((resolve) => {
        if (context?.abortSignal?.aborted) resolve();
        else context?.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    return ({
      query: input.query,
      context: {
        agentId: context?.agentId,
        runId: context?.runId,
        projectId: context?.projectId,
        toolCallId: context?.toolCallId,
      },
      fields: Object.keys(context ?? {}).sort(),
      observations: observations(),
      hasParentSecret: Object.hasOwn(process.env, "VF_NATIVE_PARENT_SECRET"),
    });
  },
});
