/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { serverLogger } from "#veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";
import { readBodyWithLimit } from "#veryfront/security";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  HTTP_PAYLOAD_TOO_LARGE,
} from "#veryfront/utils/constants/index.ts";
import { VeryfrontError } from "#veryfront/errors";

const logger = serverLogger.component("rsc");

/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export async function handleActionRequest(
  { req, projectDir, adapter }: ActionRequestParams,
): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await readBodyWithLimit(req, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    if (
      error instanceof VeryfrontError &&
      error.slug === "input-validation-failed" &&
      error.detail === "Request body exceeds size limit"
    ) {
      return jsonErrorResponse(HTTP_PAYLOAD_TOO_LARGE, "Request body too large");
    }
    logger.warn("Failed to parse action request body", { error });
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "Invalid JSON body");
  }

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof Response) return parseResult;

  const { id, args } = parseResult;

  // The default guard allows actions. A guard load failure must fail closed.
  let rscActionGuard:
    | ((req: Request, info: { id: string; args: unknown[] }) => boolean | Promise<boolean>)
    | undefined;
  try {
    ({ rscActionGuard } = await import("#veryfront/rendering/rsc/server-action-guard.ts"));
  } catch (error) {
    logger.error("Failed to load server-action guard; refusing action (fail closed)", { error });
    return jsonErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "Internal Server Error");
  }

  if (typeof rscActionGuard === "function") {
    const ok = await rscActionGuard(req, { id, args });
    if (!ok) return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
  }

  const file = `${projectDir}/app/actions/${id}.ts`;

  try {
    const st = await adapter.fs.stat(file);
    if (!st.isFile) return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  } catch (_) {
    /* expected: action file may not exist */
    return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  }

  const mod = (await import(`file://${file}`)) as Record<string, unknown>;
  const fn = mod.default ?? mod.action;

  if (typeof fn !== "function") {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action");
  }

  const result = await (fn as (...args: unknown[]) => Promise<unknown>)(...args);

  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}
