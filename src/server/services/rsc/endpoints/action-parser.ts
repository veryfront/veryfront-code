import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import type { ActionBody } from "./types.ts";
import { ActionPayloadSchema } from "../../../schemas/index.ts";

const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

function isValidActionId(id: string): boolean {
  return (
    ACTION_ID_PATTERN.test(id) &&
    !id.startsWith("/") &&
    !id.includes("..") &&
    !id.endsWith("/")
  );
}

export async function parseActionBody(body: unknown): Promise<ActionBody | Response> {
  const parsed = ActionPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : undefined;
    const message = typeof id !== "string" || id.length === 0
      ? "missing id"
      : "invalid request body";
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, message);
  }

  const { id, args } = parsed.data;
  if (!id) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "missing id");
  if (!isValidActionId(id)) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid id");

  return { id, args };
}
