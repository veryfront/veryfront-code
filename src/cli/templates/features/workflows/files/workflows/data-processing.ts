import { dependsOn, step, workflow } from "veryfront/workflow";

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
  steps: ({ input }) => {
    const format = input.options?.format ?? "json";

    const fetch = step("fetch", {
      tool: "dataFetcher",
      input: { url: input.sourceUrl },
      checkpoint: true,
    });

    const validate = dependsOn(
      step("validate", {
        tool: "dataValidator",
        input: { stepId: "fetch" },
      }),
      "fetch",
    );

    const transform = dependsOn(
      step("transform", {
        tool: "dataTransformer",
        input: { stepId: "validate" },
        checkpoint: true,
      }),
      "validate",
    );

    const aggregate = dependsOn(
      step("aggregate", {
        tool: "dataAggregator",
        input: { stepId: "validate" },
      }),
      "validate",
    );

    const merge = dependsOn(
      dependsOn(
        step("merge", {
          tool: "dataMerger",
          input: { steps: ["transform", "aggregate"] },
          checkpoint: true,
        }),
        "transform",
      ),
      "aggregate",
    );

    const exportStep = dependsOn(
      step("export", {
        tool: "dataExporter",
        input: {
          format,
          compress: input.options?.compress,
        },
      }),
      "merge",
    );

    return [fetch, validate, transform, aggregate, merge, exportStep];
  },
});

export default dataProcessingPipeline;
