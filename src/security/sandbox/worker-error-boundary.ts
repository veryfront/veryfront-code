import { ERROR_REGISTRY, type RegisteredError } from "#veryfront/errors";
import {
  sanitizeDiagnosticText,
  sanitizeStackDiagnosticText,
} from "#veryfront/errors/safe-diagnostics.ts";
import { types as nodeUtilTypes } from "node:util";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const numberIsSafeInteger = Number.isSafeInteger;
const objectDefineProperty = Object.defineProperty;
const objectPrototype = Object.prototype;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const isNativeProxy = nodeUtilTypes.isProxy;

const INVALID_WORKER_FIELD = Symbol("invalid-worker-field");
type InvalidWorkerField = typeof INVALID_WORKER_FIELD;

interface WorkerErrorSnapshot {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
  readonly definition?: RegisteredError;
  readonly status?: number;
  readonly detail?: string;
  readonly cause?: string;
  readonly instance?: string;
}

function getDataDescriptors(value: unknown): PropertyDescriptorMap | null {
  if (
    typeof value !== "object" ||
    value === null ||
    isNativeProxy(value) ||
    apply(arrayIsArray, Array, [value])
  ) {
    return null;
  }

  try {
    const prototype = getPrototypeOf(value);
    if (prototype !== objectPrototype && prototype !== null) return null;
    return getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
}

function dataField(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown | InvalidWorkerField {
  if (!apply(objectPrototypeHasOwnProperty, descriptors, [key])) return undefined;
  const descriptor = descriptors[key];
  if (!descriptor) return INVALID_WORKER_FIELD;
  return apply(objectPrototypeHasOwnProperty, descriptor, ["value"])
    ? descriptor.value
    : INVALID_WORKER_FIELD;
}

function optionalDiagnostic(
  descriptors: PropertyDescriptorMap,
  key: string,
): string | undefined | InvalidWorkerField {
  const value = dataField(descriptors, key);
  if (value === INVALID_WORKER_FIELD) return value;
  if (value === undefined) return undefined;
  return typeof value === "string" ? sanitizeDiagnosticText(value) : INVALID_WORKER_FIELD;
}

function snapshotSerializedWorkerError(serialized: unknown): WorkerErrorSnapshot {
  const descriptors = getDataDescriptors(serialized);
  if (!descriptors) {
    return { message: "Unknown error", name: "Error" };
  }

  const rawMessage = dataField(descriptors, "message");
  const rawName = dataField(descriptors, "name");
  const rawStack = dataField(descriptors, "stack");
  const message = typeof rawMessage === "string"
    ? sanitizeDiagnosticText(rawMessage)
    : "Unknown error";
  const name = typeof rawName === "string" ? sanitizeDiagnosticText(rawName) : "Error";
  const stack = typeof rawStack === "string" ? sanitizeStackDiagnosticText(rawStack) : undefined;

  const problem = dataField(descriptors, "problem");
  const problemDescriptors = getDataDescriptors(problem);
  if (!problemDescriptors) return { message, name, stack };

  const slug = dataField(problemDescriptors, "slug");
  if (
    typeof slug !== "string" ||
    !apply(objectPrototypeHasOwnProperty, ERROR_REGISTRY, [slug])
  ) {
    return { message, name, stack };
  }

  const definition = ERROR_REGISTRY[slug as keyof typeof ERROR_REGISTRY];
  const category = dataField(problemDescriptors, "category");
  const status = dataField(problemDescriptors, "status");
  const title = dataField(problemDescriptors, "title");
  const suggestion = dataField(problemDescriptors, "suggestion");
  if (
    category !== definition.category ||
    title !== definition.title ||
    suggestion !== definition.suggestion ||
    typeof status !== "number" ||
    !numberIsSafeInteger(status) ||
    status < 400 ||
    status >= 600
  ) {
    return { message, name, stack };
  }

  const detail = optionalDiagnostic(problemDescriptors, "detail");
  const cause = optionalDiagnostic(problemDescriptors, "cause");
  const instance = optionalDiagnostic(problemDescriptors, "instance");
  if (
    detail === INVALID_WORKER_FIELD ||
    cause === INVALID_WORKER_FIELD ||
    instance === INVALID_WORKER_FIELD
  ) {
    return { message, name, stack };
  }

  return {
    message,
    name,
    stack,
    definition,
    status,
    detail,
    cause,
    instance,
  };
}

function applySerializedStack(error: Error, stack: unknown): void {
  if (typeof stack !== "string") return;
  try {
    apply(objectDefineProperty, Object, [
      error,
      "stack",
      {
        configurable: true,
        value: stack,
        writable: true,
      },
    ]);
  } catch {
    // The shared boundary still returns a safe error without a stack.
  }
}

/**
 * Decode one worker-owned error snapshot without trusting project metadata or
 * invoking accessors across the host boundary.
 */
export function deserializeWorkerError(serialized: unknown): Error {
  const snapshot = snapshotSerializedWorkerError(serialized);
  if (snapshot.definition) {
    const error = snapshot.definition.create({
      message: snapshot.message,
      status: snapshot.status,
      detail: snapshot.detail,
      cause: snapshot.cause,
      instance: snapshot.instance,
    });
    applySerializedStack(error, snapshot.stack);
    return error;
  }

  const error = new Error(snapshot.message);
  error.name = snapshot.name;
  applySerializedStack(error, snapshot.stack);
  return error;
}
