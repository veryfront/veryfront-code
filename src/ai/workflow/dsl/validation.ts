/**
 * DSL Validation Utilities
 *
 * Shared validation functions for workflow node builders
 */

/**
 * Validate that a node ID is a non-empty string.
 * @throws Error if the ID is invalid
 */
export function validateNodeId(id: string): void {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }
}
