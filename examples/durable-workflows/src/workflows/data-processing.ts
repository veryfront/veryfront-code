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

/**
 * Input for the data processing pipeline
 */
export interface DataProcessingInput {
  /** Source data URL */
  sourceUrl: string;
  /** Processing options */
  options?: {
    chunkSize?: number;
    format?: "json" | "csv" | "parquet";
    compress?: boolean;
  };
}

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

  steps: ({ input }) => [
    // Step 1: Fetch data
    step("fetch", {
      tool: "dataFetcher",
      input: { url: input.sourceUrl },
      checkpoint: true,
    }),

    // Step 2: Validate (depends on fetch)
    dependsOn(
      step("validate", {
        tool: "dataValidator",
        input: { stepId: "fetch" },
      }),
      "fetch"
    ),

    // Step 3a: Transform (depends on validate)
    dependsOn(
      step("transform", {
        tool: "dataTransformer",
        input: { stepId: "validate" },
        checkpoint: true,
      }),
      "validate"
    ),

    // Step 3b: Aggregate (depends on validate, parallel with transform)
    dependsOn(
      step("aggregate", {
        tool: "dataAggregator",
        input: { stepId: "validate" },
      }),
      "validate"
    ),

    // Step 3c: Enrich (depends on validate, parallel with transform/aggregate)
    dependsOn(
      step("enrich", {
        tool: "dataEnricher",
        input: { stepId: "validate" },
        timeout: "2m",
      }),
      "validate"
    ),

    // Step 4: Merge (depends on transform, aggregate, enrich)
    dependsOn(
      dependsOn(
        dependsOn(
          step("merge", {
            tool: "dataMerger",
            input: { steps: ["transform", "aggregate", "enrich"] },
            checkpoint: true,
          }),
          "transform"
        ),
        "aggregate"
      ),
      "enrich"
    ),

    // Step 5: Export (depends on merge)
    dependsOn(
      step("export", {
        tool: "dataExporter",
        input: {
          format: input.options?.format || "json",
          compress: input.options?.compress,
        },
      }),
      "merge"
    ),
  ],
});

export default dataProcessingPipeline;
