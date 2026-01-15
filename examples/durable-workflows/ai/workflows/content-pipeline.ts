/**
 * Content Pipeline Workflow
 *
 * A multi-step content generation workflow with human-in-the-loop approval.
 *
 * Steps:
 * 1. Research - Gather information on the topic
 * 2. Generate (parallel) - Write content and generate images
 * 3. Review - Human approval gate
 * 4. Publish - Publish the content
 */

import {
  branch,
  parallel,
  step,
  waitForApproval,
  workflow,
} from "veryfront/ai/workflow";
import { z } from "zod";

/**
 * Input schema for the content pipeline
 */
const contentPipelineInputSchema = z.object({
  /** Topic to create content about */
  topic: z.string().describe("Topic to create content about"),
  /** Target audience */
  audience: z.string().optional().describe("Target audience"),
  /** Whether approval is required before publishing */
  requiresApproval: z.boolean().default(true).describe("Whether approval is required"),
  /** Content format */
  format: z.enum(["blog", "social", "newsletter"]).optional().default("blog").describe("Content format"),
});

/**
 * Input type (inferred from schema)
 */
export type ContentPipelineInput = z.infer<typeof contentPipelineInputSchema>;

/**
 * Output from the content pipeline
 */
export interface ContentPipelineOutput {
  /** Generated content */
  content: string;
  /** Image URLs */
  images: string[];
  /** Metadata */
  metadata: {
    wordCount: number;
    readingTime: string;
    publishedAt?: Date;
  };
}

/**
 * Content Pipeline Workflow Definition
 *
 * This demonstrates:
 * - Sequential steps
 * - Parallel execution
 * - Conditional branching
 * - Human-in-the-loop approvals
 */
export const contentPipeline = workflow<ContentPipelineInput, ContentPipelineOutput>({
  id: "content-pipeline",
  description: "Multi-step content generation with human approval",
  version: "1.0.0",
  inputSchema: contentPipelineInputSchema,

  steps: ({ input }) => [
    // Step 1: Research the topic
    step("research", {
      agent: "researcher",
      input: `Research the following topic thoroughly: "${input.topic}"
        ${input.audience ? `Target audience: ${input.audience}` : ""}`,
      timeout: "5m",
      retry: { maxAttempts: 2 },
    }),

    // Step 2: Generate content and images in parallel
    parallel("generate", [
      // Write the content
      step("write", {
        agent: "writer",
        input: `Write engaging ${input.format || "blog"} content about "${input.topic}".`,
        timeout: "10m",
      }),

      // Generate images
      step("images", {
        tool: "imageGenerator",
        input: {
          prompt: `Create visual content for: ${input.topic}`,
          count: 3,
          style: "professional",
        },
        timeout: "3m",
      }),
    ]),

    // Step 3: Conditional approval gate
    branch("review", {
      condition: () => input.requiresApproval,
      then: [
        waitForApproval("human-review", {
          message: "Please review the generated content before publishing",
          timeout: "24h",
        }),
      ],
      else: [
        // Auto-approve step (using a mock tool)
        step("auto-approve", {
          tool: "autoApprover",
          input: { approved: true },
        }),
      ],
    }),

    // Step 4: Publish the content
    step("publish", {
      agent: "publisher",
      input: "Publish the approved content to the appropriate channels.",
      timeout: "2m",
    }),
  ],

  onError: (error, context) => {
    console.error(`[ContentPipeline] Error in run ${context.runId}:`, error);
  },

  onComplete: (result, context) => {
    // The result is the accumulated context from all workflow steps
    // Extract meaningful data from the step outputs
    const output = result as Record<string, unknown>;
    console.log(`[ContentPipeline] Completed run ${context.runId}:`, {
      steps: Object.keys(output),
      hasWriteStep: "write" in output,
      hasImages: "images" in output,
    });
  },
});

export default contentPipeline;
