/**
 * Error schemas
 *
 * Schemas for error codes and error handling.
 */

import { z } from "zod";

/**
 * Error code schema
 */
export const errorCodeSchema = z.enum([
  "FILE_NOT_FOUND",
  "BUILD_ERROR",
  "CONFIG_ERROR",
  "COMPILATION_ERROR",
  "NETWORK_ERROR",
  "PERMISSION_ERROR",
  "RENDER_ERROR",
  "INITIALIZATION_ERROR",
  "AGENT_ERROR",
  "AGENT_NOT_FOUND",
  "AGENT_TIMEOUT",
  "AGENT_INTENT_ERROR",
  "ORCHESTRATION_ERROR",
  "NOT_SUPPORTED",
  "SERVICE_OVERLOADED",
]);

/**
 * Error code constants (for runtime value access)
 * Provides enum-like value access: ErrorCode.CONFIG_ERROR
 */
export const ErrorCode = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  BUILD_ERROR: "BUILD_ERROR",
  CONFIG_ERROR: "CONFIG_ERROR",
  COMPILATION_ERROR: "COMPILATION_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  PERMISSION_ERROR: "PERMISSION_ERROR",
  RENDER_ERROR: "RENDER_ERROR",
  INITIALIZATION_ERROR: "INITIALIZATION_ERROR",
  AGENT_ERROR: "AGENT_ERROR",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  AGENT_INTENT_ERROR: "AGENT_INTENT_ERROR",
  ORCHESTRATION_ERROR: "ORCHESTRATION_ERROR",
  NOT_SUPPORTED: "NOT_SUPPORTED",
  SERVICE_OVERLOADED: "SERVICE_OVERLOADED",
} as const;

// Inferred type
export type ErrorCodeType = z.infer<typeof errorCodeSchema>;
