/**
 * Action request body parser and validator
 * @module rsc-endpoints/action-parser
 */

import { HTTP_BAD_REQUEST } from "@veryfront/utils";
import type { ActionBody } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

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
    const zodModule = await import("zod");
    const { z } = zodModule;
    const Payload = z.object({
      id: z.string().min(1),
      args: z.array(z.unknown()).max(50).optional().default([]),
    });
    const parsed = Payload.parse(body);
    id = parsed.id;
    args = parsed.args;
  } catch (schemaError) {
    serverLogger.debug("[ActionParser] Zod validation failed, using manual parsing", schemaError);
    const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    id = String(bodyObj.id ?? "");
    args = Array.isArray(bodyObj.args) ? bodyObj.args : [];
  }

  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: "missing id" }), {
      status: HTTP_BAD_REQUEST,
      headers: { "content-type": "application/json" },
    });
  }

  if (!Array.isArray(args)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid args" }), {
      status: HTTP_BAD_REQUEST,
      headers: { "content-type": "application/json" },
    });
  }

  // Basic input validation to prevent traversal and malformed ids
  const isValidId = /^[A-Za-z0-9_/-]+(?:\/[A-Za-z0-9_/-]+)*$/.test(id) &&
    !id.startsWith("/") &&
    !id.includes("..") &&
    !id.endsWith("/");

  if (!isValidId) {
    return new Response(JSON.stringify({ ok: false, error: "invalid id" }), {
      status: HTTP_BAD_REQUEST,
      headers: { "content-type": "application/json" },
    });
  }

  return { id, args };
}
