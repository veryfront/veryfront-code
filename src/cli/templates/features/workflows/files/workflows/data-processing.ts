
import { dependsOn, step, workflow } from "veryfront/ai/workflow";

export interface DataProcessingInput {
  sourceUrl: string;
  options?: {
    chunkSize?: number;
    format?: "json" | "csv" | "parquet";
    compress?: boolean;
  };
}

export interface DataProcessingOutput {
  outputUrl: string;
  stats: {
    recordsProcessed: number;
    duration: number;
    errors: number;
  };
}

export const dataProcessingPipeline = workflow<DataProcessingInput, DataProcessingOutput>({
  id: "data-processing",
  description: "DAG-based data processing with checkpointing",
  version: "1.0.0",

  steps: ({ input }) => [
    step("fetch", {
      tool: "dataFetcher",
      input: { url: input.sourceUrl },
      checkpoint: true,
    }),

    dependsOn(
      step("validate", {
        tool: "dataValidator",
        input: { stepId: "fetch" },
      }),
      "fetch",
    ),

    dependsOn(
      step("transform", {
        tool: "dataTransformer",
        input: { stepId: "validate" },
        checkpoint: true,
      }),
      "validate",
    ),

    dependsOn(
      step("aggregate", {
        tool: "dataAggregator",
        input: { stepId: "validate" },
      }),
      "validate",
    ),

    dependsOn(
      dependsOn(
        step("merge", {
          tool: "dataMerger",
          input: { steps: ["transform", "aggregate"] },
          checkpoint: true,
        }),
        "transform",
      ),
      "aggregate",
    ),

    dependsOn(
      step("export", {
        tool: "dataExporter",
        input: {
          format: input.options?.format || "json",
          compress: input.options?.compress,
        },
      }),
      "merge",
    ),
  ],
});

export default dataProcessingPipeline;
