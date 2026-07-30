import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import type { ActionBody } from "./types.ts";

const ACTION_ID_MAX_LENGTH = 512;
const ACTION_ARGS_MAX_LENGTH = 50;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const arrayIsArray = Array.isArray;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

function isValidActionId(id: string): boolean {
  return (
    id.length <= ACTION_ID_MAX_LENGTH &&
    ACTION_ID_PATTERN.test(id) &&
    !id.startsWith("/") &&
    !id.includes("..") &&
    !id.endsWith("/")
  );
}

function snapshotArgs(value: unknown): unknown[] | null {
  if (!arrayIsArray(value)) return null;

  try {
    const descriptors = getOwnPropertyDescriptors(value) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      length > ACTION_ARGS_MAX_LENGTH
    ) return null;

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || !("value" in descriptor)) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export async function parseActionBody(body: unknown): Promise<ActionBody | Response> {
  if (!body || typeof body !== "object" || arrayIsArray(body)) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = getOwnPropertyDescriptors(body);
  } catch {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
  }

  const idDescriptor = descriptors.id;
  const id = idDescriptor && "value" in idDescriptor && typeof idDescriptor.value === "string"
    ? idDescriptor.value
    : "";
  if (!id) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "missing id");
  if (!isValidActionId(id)) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid id");

  const argsDescriptor = descriptors.args;
  const args = argsDescriptor === undefined
    ? []
    : "value" in argsDescriptor
    ? snapshotArgs(argsDescriptor.value)
    : null;
  if (!args) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid args");

  return { id, args };
}
