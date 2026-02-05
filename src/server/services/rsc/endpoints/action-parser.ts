import { serverLogger } from "#veryfront/utils";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import type { ActionBody } from "./types.ts";
import { ActionPayloadSchema } from "../../../schemas/index.ts";

const ACTION_ID_PATTERN = /^[A-Za-z0-9_/-]+(?:\/[A-Za-z0-9_/-]+)*$/;

function isValidActionId(id: string): boolean {
  return (
    ACTION_ID_PATTERN.test(id) &&
    !id.startsWith("/") &&
    !id.includes("..") &&
    !id.endsWith("/")
  );
}

export async function parseActionBody(body: unknown): Promise<ActionBody | Response> {
  let id = "";
  let args: unknown[] = [];

  try {
    const parsed = ActionPayloadSchema.parse(body);
    id = parsed.id;
    args = parsed.args;
  } catch (schemaError) {
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

  if (!id) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "missing id");
  if (!isValidActionId(id)) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid id");

  return { id, args };
}
