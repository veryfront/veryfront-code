import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Validate that a node ID is a non-empty string */
export function validateNodeId(id: string): void {
  if (!id.trim()) {
    throw INVALID_ARGUMENT.create({ detail: "Node ID must be a non-empty string" });
  }
}
