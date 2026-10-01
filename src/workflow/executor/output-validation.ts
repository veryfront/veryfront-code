import type { WorkflowDefinition } from "../types.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  formatSchemaValidationErrors,
  OutputSchemaValidationError,
  toSchemaValidationErrors,
} from "#veryfront/schemas/validation-errors.ts";

/** Typed failures a DAG can return while retaining registry slugs where present. */
export type WorkflowExecutionError = (VeryfrontError | OutputSchemaValidationError) & {
  readonly slug?: string;
};

/** Whether an execution failure carries structured run-error metadata. */
export function isWorkflowExecutionError(error: Error): error is WorkflowExecutionError {
  return error instanceof VeryfrontError || error instanceof OutputSchemaValidationError;
}

/** Parse one workflow output or raise the typed validation failure persisted on its run. */
export function parseWorkflowOutput(
  workflow: WorkflowDefinition,
  output: unknown,
): unknown {
  if (!workflow.outputSchema) return output;
  const result = workflow.outputSchema.safeParse(output);
  if (result.success) return result.data;
  const errors = toSchemaValidationErrors(result.issues ?? []);
  throw new OutputSchemaValidationError(
    `Workflow "${workflow.id}" output failed outputSchema validation: ${
      formatSchemaValidationErrors(errors)
    }`,
    errors,
  );
}
