/**
 * Action request body parser and validator
 * @module rsc-endpoints/action-parser
 */

import { serverLogger } from "@veryfront/utils";
import { HttpStatus, jsonErrorResponse } from "@veryfront/http/responses.ts";
import type { ActionBody } from "./types.ts";

/** Validates action ID format to prevent traversal and malformed ids */
const ACTION_ID_PATTERN = /^[A-Za-z0-9_/-]+(?:\/[A-Za-z0-9_/-]+)*$/;

function isValidActionId(id: string): boolean {
  return ACTION_ID_PATTERN.test(id) &&
    !id.startsWith("/") &&
    !id.includes("..") &&
    !id.endsWith("/");
}

/**
 * Parse and validate action request body
 * @param body - Raw request body
 * @returns Parsed action body or error response
 */
export async function parseActionBody(
  body: unknown,
): Promise<ActionBody | Response> {
  let id: string;
  let args: unknown[];

  try {
    const { z } = await import("zod");
    const Payload = z.object({
      id: z.string().min(1),
      args: z.array(z.unknown()).max(50).optional().default([]),
    });
    const parsed = Payload.parse(body);
    id = parsed.id;
    args = parsed.args;
  } catch (schemaError) {
    // Zod failed - use manual parsing with strict validation
    serverLogger.warn(
      "[ActionParser] Zod validation failed, falling back to manual parsing",
      { error: schemaError instanceof Error ? schemaError.message : String(schemaError) },
    );
    if (!body || typeof body !== "object") {
      return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
    }
    const bodyObj = body as Record<string, unknown>;
    id = typeof bodyObj.id === "string" ? bodyObj.id : "";
    args = Array.isArray(bodyObj.args) ? bodyObj.args : [];
  }

  if (!id) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "missing id");
  }

  if (!isValidActionId(id)) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid id");
  }

  return { id, args };
}
