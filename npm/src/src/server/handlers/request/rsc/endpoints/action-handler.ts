/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */
import * as dntShim from "../../../../../../_dnt.shims.js";


import { HttpStatus, jsonErrorResponse } from "../../../../../platform/compat/http/responses.js";
import { serverLogger } from "../../../../../utils/index.js";
import { parseActionBody } from "./action-parser.js";
import type { ActionRequestParams } from "./types.js";

/**
 * Handle action request with guard checks
 * @param params - Action request parameters
 * @returns Response with action result or error
 */
export async function handleActionRequest(
  { req, projectDir, adapter }: ActionRequestParams,
): Promise<dntShim.Response> {
  const body = await req.json().catch((error) => {
    serverLogger.warn("[RSC] Failed to parse action request body", { error });
    return {} as Record<string, unknown>;
  });

  const parseResult = await parseActionBody(body);
  if (parseResult instanceof dntShim.Response) return parseResult;

  const { id, args } = parseResult;

  try {
    const { rscActionGuard } = await import("../../../../../rendering/rsc/server-action-guard.js");
    if (typeof rscActionGuard === "function") {
      const ok = await rscActionGuard(req, { id, args });
      if (!ok) return jsonErrorResponse(HttpStatus.FORBIDDEN, "unauthorized");
    }
  } catch (e) {
    serverLogger.debug("[rsc][dev] guard load failed", e);
  }

  const file = `${projectDir}/app/actions/${id}.ts`;

  try {
    const st = await adapter.fs.stat(file);
    if (!st.isFile) return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  } catch {
    return jsonErrorResponse(HttpStatus.NOT_FOUND, "action not found");
  }

  const mod = (await import(`file://${file}`)) as Record<string, unknown>;
  const fn = mod.default ?? mod.action;

  if (typeof fn !== "function") {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid action");
  }

  const result = await (fn as (...args: unknown[]) => Promise<unknown>)(...args);

  return new dntShim.Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}
