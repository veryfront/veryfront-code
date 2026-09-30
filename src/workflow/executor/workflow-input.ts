import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import {
  formatSchemaValidationErrors,
  toSchemaValidationErrors,
} from "#veryfront/schemas/validation-errors.ts";
import type { WorkflowDefinition } from "../types.ts";

/**
 * Parse submitted input against the declared inputSchema. Invalid input fails
 * before building or executing steps, with INPUT_VALIDATION_FAILED and the validation
 * errors in `context.errors` (veryfront/veryfront-issue-inbox#2091).
 */
export function parseWorkflowInput(workflow: WorkflowDefinition, input: unknown): unknown {
  if (!workflow.inputSchema) return input;
  const result = workflow.inputSchema.safeParse(input);
  if (result.success) return result.data;
  const errors = toSchemaValidationErrors(result.issues ?? []);
  throw INPUT_VALIDATION_FAILED.create({
    detail: `Workflow "${workflow.id}" input failed inputSchema validation: ${
      formatSchemaValidationErrors(errors)
    }`,
    context: { errors },
  });
}
