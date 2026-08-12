import { workflow, step, parallel, waitForApproval } from "veryfront/workflow";

/** Typing the input makes `input.topic` available to every step below. */
interface ContentPipelineInput {
  topic: string;
}

export default workflow<ContentPipelineInput>({
  id: "content-pipeline",
  description: "Research, write, review, and publish content",
  steps: ({ input }) => [
    step("research", {
      agent: "researcher",
      input: { topic: input.topic },
    }),

    parallel("draft", [
      step("write-article", { agent: "writer" }),
      step("write-summary", { agent: "writer", input: { format: "summary" } }),
    ]),

    waitForApproval("editorial-review", {
      message: "Review the draft before publishing",
      timeout: "24h",
    }),

    // Every step runs an agent or a tool. `tools/publish.ts` is where the
    // publishing logic lives.
    step("publish", { tool: "publish" }),
  ],
});
