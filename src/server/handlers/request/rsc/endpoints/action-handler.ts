/**
 * Action request handler with guard checks
 * @module rsc-endpoints/action-handler
 */

import { createError, toError } from "../../../../../core/errors/veryfront-error.ts";
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from "@veryfront/utils";
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
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
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
        return new Response(
          JSON.stringify({ ok: false, error: "unauthorized" }),
          {
            status: HTTP_FORBIDDEN,
            headers: { "content-type": "application/json" },
          },
        );
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
    return new Response(
      JSON.stringify({ ok: false, error: "action not found" }),
      {
        status: HTTP_NOT_FOUND,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const mod = await import(`file://${file}`) as Record<string, unknown>;

  const fn = (mod?.default ?? mod?.action) as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;

  if (typeof fn !== "function") {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid action" }),
      {
        status: HTTP_BAD_REQUEST,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const result = await fn(...args);
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}
