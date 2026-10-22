import { parallel, step, waitForApproval, workflow } from "veryfront/workflow";
import type { WorkflowContext } from "veryfront/workflow";

/** Typing the input makes `input.topic` available to every step below. */
interface ContentPipelineInput {
  topic: string;
}

/** Text an agent step produced. Steps store their output under their node id. */
function textOf(output: unknown): string {
  return (output as { text?: string } | undefined)?.text ?? "";
}

export default workflow<ContentPipelineInput>({
  id: "content-pipeline",
  description: "Research, write, review, and publish content",
  steps: ({ input }) => [
    step("research", {
      agent: "researcher",
      input: { topic: input.topic },
    }),

    // Parallel steps are stored as "<group>/<step>", e.g. "draft/write-article".
    parallel("draft", [
      step("write-article", {
        agent: "writer",
        input: (context) => `Write an article from these notes:\n\n${textOf(context.research)}`,
      }),
      step("write-summary", {
        agent: "writer",
        input: (context) => `Summarize these notes in three sentences:\n\n${textOf(context.research)}`,
      }),
    ]),

    // The payload is what the reviewer reads on the run page before deciding.
    waitForApproval("editorial-review", {
      message: "Review the draft before publishing",
      payload: (context: WorkflowContext) => ({
        article: textOf(context["draft/write-article"]),
        summary: textOf(context["draft/write-summary"]),
      }),
      timeout: "24h",
    }),

    // Every step runs an agent or a tool. `tools/publish.ts` is where the
    // publishing logic lives.
    step("publish", {
      tool: "publish",
      input: (context) => ({
        title: input.topic,
        article: textOf(context["draft/write-article"]),
      }),
    }),
  ],
});
