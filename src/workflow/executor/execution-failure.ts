const executionFailureCauses = new WeakMap<object, Error>();

/** Retain an in-memory failure identity without changing a result's public shape. */
export function retainExecutionFailure<T extends object>(result: T, cause: Error | undefined): T {
  if (cause !== undefined) executionFailureCauses.set(result, cause);
  return result;
}

/** Read an in-memory failure identity retained by an inner executor boundary. */
export function getExecutionFailure(result: object): Error | undefined {
  return executionFailureCauses.get(result);
}
