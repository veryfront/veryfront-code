/**
 * Data Processing Pipeline Workflow
 *
 * A DAG-based data processing workflow demonstrating:
 * - Complex dependencies using dependsOn
 * - Parallel processing paths
 * - Checkpointing for durability
 */

import {
  dependsOn,
  step,
  workflow,
} from "veryfront/ai/workflow";
import { z } from "zod";

/**
 * Input schema for the data processing pipeline
 */
const dataProcessingInputSchema = z.object({
  /** Source data URL */
  sourceUrl: z.string().describe("Source data URL to fetch and process"),
  /** Processing options */
  options: z.object({
    chunkSize: z.number().optional().default(1000).describe("Chunk size for processing"),
    format: z.enum(["json", "csv", "parquet"]).optional().default("json").describe("Output format"),
    compress: z.boolean().optional().default(false).describe("Whether to compress output"),
  }).optional().describe("Processing options"),
});

/**
 * Input for the data processing pipeline (inferred from schema)
 */
export type DataProcessingInput = z.infer<typeof dataProcessingInputSchema>;

/**
 * Output from the data processing pipeline
 */
export interface DataProcessingOutput {
  /** Processed data URL */
  outputUrl: string;
  /** Processing statistics */
  stats: {
    recordsProcessed: number;
    duration: number;
    errors: number;
  };
}

/**
 * Data Processing Pipeline
 *
 * DAG Structure:
 *
 *   fetch --> validate --> [transform, aggregate, enrich] --> merge --> export
 *
 * The parallel paths (transform, aggregate, enrich) all depend on validate,
 * and merge depends on all three parallel paths completing.
 */
export const dataProcessingPipeline = workflow<DataProcessingInput, DataProcessingOutput>({
  id: "data-processing",
  description: "DAG-based data processing with checkpointing",
  version: "1.0.0",
  inputSchema: dataProcessingInputSchema,

  steps: ({ input }) => [
    // Step 1: Fetch data from URL
    step("fetch", {
      tool: "dataFetcher",
      input: { url: input.sourceUrl },
      checkpoint: true,
    }),

    // Step 2: Validate the fetched data
    dependsOn(
      step("validate", {
        tool: "dataValidator",
        input: (ctx) => ({
          data: ctx.fetch?.content || ctx.fetch,
          rules: { allowEmpty: false },
        }),
      }),
      "fetch"
    ),

    // Step 3a: Transform the data
    dependsOn(
      step("transform", {
        tool: "dataTransformer",
        input: (ctx) => ({
          data: ctx.fetch?.content || ctx.fetch,
          operations: { addFields: { _processed: true } },
        }),
        checkpoint: true,
      }),
      "validate"
    ),

    // Step 3b: Aggregate numeric fields (parallel with transform)
    dependsOn(
      step("aggregate", {
        tool: "dataAggregator",
        input: (ctx) => {
          const content = ctx.fetch?.content || ctx.fetch;
          // If content is an array, use it; otherwise wrap in array
          const data = Array.isArray(content) ? content : [content];
          return { data };
        },
      }),
      "validate"
    ),

    // Step 3c: Enrich with metadata (parallel with transform/aggregate)
    dependsOn(
      step("enrich", {
        tool: "dataEnricher",
        input: (ctx) => ({
          data: ctx.fetch?.content || ctx.fetch,
          enrichments: { addTimestamp: true, addId: true },
        }),
        timeout: "2m",
      }),
      "validate"
    ),

    // Step 4: Merge results from parallel paths
    dependsOn(
      dependsOn(
        dependsOn(
          step("merge", {
            tool: "dataMerger",
            input: (ctx) => ({
              datasets: [
                ctx.transform?.result,
                ctx.aggregate?.statistics,
                ctx.enrich?.result,
              ].filter(Boolean),
              strategy: "deep_merge",
            }),
            checkpoint: true,
          }),
          "transform"
        ),
        "aggregate"
      ),
      "enrich"
    ),

    // Step 5: Export to requested format
    dependsOn(
      step("export", {
        tool: "dataExporter",
        input: (ctx) => ({
          data: ctx.merge?.result,
          format: input.options?.format || "json",
          pretty: true,
        }),
      }),
      "merge"
    ),
  ],
});

export default dataProcessingPipeline;
