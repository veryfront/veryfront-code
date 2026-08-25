import { RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS } from "#veryfront/extensions/auth/index.ts";
import { HttpStatus, jsonErrorResponse } from "#veryfront/http/responses";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { ActionBody } from "./types.ts";

const ACTION_ID_MAX_LENGTH = 512;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativeArray = Array;
const numberIsSafeInteger = Number.isSafeInteger;
const objectPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;

function hasOwn(value: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, value, [key]) as boolean;
}

function descriptorValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor !== undefined && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function defineArrayValue(target: unknown[], index: number, value: unknown): void {
  defineProperty(target, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

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
  if (
    !arrayIsArray(value) || isProxyWithoutHooks(value) ||
    getPrototypeOf(value) !== arrayPrototype
  ) return null;

  try {
    const descriptors = getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const length = descriptorValue(descriptors.length);
    if (
      typeof length !== "number" || !numberIsSafeInteger(length) || length < 0 ||
      length > RSC_ACTION_MAX_TOP_LEVEL_ARGUMENTS ||
      ownKeys(descriptors).length !== length + 1
    ) return null;

    const snapshot = new NativeArray<unknown>(length);
    for (let index = 0; index < length; index++) {
      const descriptor = hasOwn(descriptors, String(index)) ? descriptors[index] : undefined;
      if (
        !descriptor || descriptor.enumerable !== true ||
        !hasOwn(descriptor, "value")
      ) return null;
      defineArrayValue(snapshot, index, descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export async function parseActionBody(body: unknown): Promise<ActionBody | Response> {
  if (
    !body || typeof body !== "object" || arrayIsArray(body) ||
    isProxyWithoutHooks(body)
  ) {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
  }

  let descriptors: PropertyDescriptorMap;
  try {
    const prototype = getPrototypeOf(body);
    if (prototype !== objectPrototype && prototype !== null) {
      return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
    }
    descriptors = getOwnPropertyDescriptors(body);
  } catch {
    return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid request body");
  }

  const idDescriptor = hasOwn(descriptors, "id") ? descriptors.id : undefined;
  const id = idDescriptor && hasOwn(idDescriptor, "value") &&
      idDescriptor.enumerable === true && typeof idDescriptor.value === "string"
    ? idDescriptor.value
    : "";
  if (!id) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "missing id");
  if (!isValidActionId(id)) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid id");

  const argsDescriptor = hasOwn(descriptors, "args") ? descriptors.args : undefined;
  const args = argsDescriptor === undefined
    ? []
    : hasOwn(argsDescriptor, "value") && argsDescriptor.enumerable === true
    ? snapshotArgs(argsDescriptor.value)
    : null;
  if (!args) return jsonErrorResponse(HttpStatus.BAD_REQUEST, "invalid args");

  return { id, args };
}
