/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { HttpStatus, jsonErrorResponse } from "@veryfront/http/responses.ts";
import { serverLogger } from "@veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";

/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export async function handleActionRequest(
  { req, projectDir, adapter }: ActionRequestParams,
): Promise<Response> {
  const body = await req.json().catch((err) => {
    serverLogger.warn("[RSC] Failed to parse action request body", { error: err });
    return {} as Record<string, unknown>;
  });
  const parseResult = await parseActionBody(body);

  if (parseResult instanceof Response) {
    return parseResult;
  }

  const { id, args } = parseResult;

  // Optional guard
  try {
    const guard = (await import("../../rsc/server-action-guard.ts")).rscActionGuard;
    if (typeof guard === "function") {
      const ok = await guard(req, { id, args });
      if (!ok) {
        return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
      }
    }
  } catch (e) {
    serverLogger.debug("[rsc][dev] guard load failed", e);
  }

  const file = `${projectDir}/app/actions/${id}.ts`;
  try {
    const st = await adapter.fs.stat(file);
    if (!st.isFile) {
      throw toError(createError({
        type: "config",
        message: "nf",
      }));
    }
  } catch {
    return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  }

  const mod = await import(`file://${file}`) as Record<string, unknown>;

  const fn = (mod?.default ?? mod?.action) as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;

  if (typeof fn !== "function") {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action");
  }

  const result = await fn(...args);
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}
