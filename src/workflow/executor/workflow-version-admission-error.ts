const workflowVersionAdmissionErrors = new WeakSet<Error>();

/** Mark one deterministic workflow-version proof failure for lifecycle compensation. */
export function markWorkflowVersionAdmissionError<T extends Error>(error: T): T {
  workflowVersionAdmissionErrors.add(error);
  return error;
}

/** Match only errors created by an exact workflow-version admission check. */
export function isWorkflowVersionAdmissionError(error: unknown): error is Error {
  return error instanceof Error && workflowVersionAdmissionErrors.has(error);
}
