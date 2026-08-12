import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

/**
 * Final step of `workflows/content-pipeline.ts`.
 *
 * Replace the body with a call to your CMS, static site build, or storage
 * bucket. The workflow reaches this step only after the approval gate passes.
 */
export default tool({
  id: "publish",
  description: "Publish an approved draft",
  inputSchema: defineSchema((v) =>
    v.object({
      title: v.string().default("Untitled").describe("Headline of the article"),
    })
  )(),
  execute: ({ title }) => ({
    published: true,
    title,
    url: `/articles/${Date.now()}`,
  }),
});
