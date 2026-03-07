/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { serverLogger } from "#veryfront/utils";
import { parseActionBody } from "./action-parser.ts";
import type { ActionRequestParams } from "./types.ts";

const logger = serverLogger.component("rsc");

/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export async function handleActionRequest(
  { req, projectDir, adapter }: ActionRequestParams,
): Promise<Response> {
  const body = await req.json().catch((error) => {
    logger.warn("Failed to parse action request body", { error });
    return {};
  });

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof Response) return parseResult;

  const { id, args } = parseResult;

  try {
    const { rscActionGuard } = await import("#veryfront/rendering/rsc/server-action-guard.ts");
    if (typeof rscActionGuard === "function") {
      const ok = await rscActionGuard(req, { id, args });
      if (!ok) return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
    }
  } catch (error) {
    logger.debug("[dev] guard load failed", error);
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
