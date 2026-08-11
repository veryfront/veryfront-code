import { workflow, step, parallel, waitForApproval } from "veryfront/workflow";

export default workflow({
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

    step("publish", {
      execute: async ({ previous }) => {
        // Replace with your publishing logic
        return { published: true, url: `/articles/${Date.now()}` };
      },
    }),
  ],
});
