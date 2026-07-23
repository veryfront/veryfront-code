/**
 * Validation and defensive copying for eval report export receipts.
 *
 * @module extensions/eval/eval-report-export-receipt
 */

import {
  EXTENSION_VALIDATION_ERROR,
  isVeryfrontErrorWithSlug,
} from "#veryfront/extensions/errors.ts";
import { identifierIssue } from "#veryfront/extensions/identifiers.ts";
import type { EvalReportExportReceipt } from "./eval-report-exporter-contract.ts";

const MAX_RECEIPT_ID_LENGTH = 1024;
const MAX_RECEIPT_METADATA_DEPTH = 64;
const MAX_RECEIPT_METADATA_NODES = 10_000;
const MAX_RECEIPT_METADATA_STRING_CHARS = 1_000_000;
const MAX_RECEIPT_URL_LENGTH = 4096;

function isNonArrayObject(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function assertReceiptString(
  key: string,
  value: unknown,
  maximumLength: number,
): asserts value is string {
  const issue = identifierIssue(value, maximumLength);
  if (issue) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Eval report export receipt ${key} ${issue}`,
    });
  }
}

function assertReceiptUrl(value: unknown): asserts value is string {
  assertReceiptString("url", value, MAX_RECEIPT_URL_LENGTH);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new TypeError();
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export receipt url must be an absolute HTTP or HTTPS URL",
    });
  }
}

function cloneJsonSafeReceiptMetadata(value: unknown): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  let stringCharacters = 0;

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_RECEIPT_METADATA_NODES || depth > MAX_RECEIPT_METADATA_DEPTH) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export receipt metadata is too large",
      });
    }

    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (Number.isFinite(current)) return current;
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export receipt metadata must contain finite numbers",
      });
    }
    if (typeof current === "string") {
      stringCharacters += current.length;
      if (stringCharacters <= MAX_RECEIPT_METADATA_STRING_CHARS) return current;
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export receipt metadata is too large",
      });
    }
    if (typeof current !== "object") {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export receipt metadata must be JSON-serializable",
      });
    }
    if (active.has(current)) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: "Eval report export receipt metadata must not contain cycles",
      });
    }

    active.add(current);
    try {
      if (Array.isArray(current)) {
        const length = Reflect.get(current, "length");
        if (
          typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
          length > MAX_RECEIPT_METADATA_NODES - nodes
        ) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: "Eval report export receipt metadata is too large",
          });
        }
        const result: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            throw EXTENSION_VALIDATION_ERROR.create({
              message: "Eval report export receipt metadata arrays must not contain holes",
            });
          }
          result.push(visit(Reflect.get(current, index), depth + 1));
        }
        return result;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: "Eval report export receipt metadata must contain plain objects",
        });
      }

      const keys = Reflect.ownKeys(current);
      if (keys.length > MAX_RECEIPT_METADATA_NODES - nodes) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: "Eval report export receipt metadata is too large",
        });
      }
      if (keys.some((key) => typeof key === "symbol")) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: "Eval report export receipt metadata must use string keys",
        });
      }
      const result: Record<string, unknown> = {};
      for (const key of keys as string[]) {
        stringCharacters += key.length;
        if (stringCharacters > MAX_RECEIPT_METADATA_STRING_CHARS) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: "Eval report export receipt metadata is too large",
          });
        }
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: visit(Reflect.get(current, key), depth + 1),
          writable: true,
        });
      }
      return result;
    } finally {
      active.delete(current);
    }
  };

  try {
    return visit(value, 0);
  } catch (error) {
    if (isVeryfrontErrorWithSlug(error, "extension-validation")) throw error;
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export receipt metadata properties must be readable",
    });
  }
}

/** @internal Validate and defensively copy an exporter-owned receipt. */
export function cloneEvalReportExportReceipt(
  receipt: EvalReportExportReceipt,
): EvalReportExportReceipt {
  if (!isNonArrayObject(receipt)) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export receipt must be an object",
    });
  }
  let externalRunId: unknown;
  let metadata: unknown;
  let url: unknown;
  try {
    externalRunId = receipt.externalRunId;
    metadata = receipt.metadata;
    url = receipt.url;
  } catch {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export receipt properties must be readable",
    });
  }
  if (externalRunId !== undefined) {
    assertReceiptString("externalRunId", externalRunId, MAX_RECEIPT_ID_LENGTH);
  }
  if (url !== undefined) assertReceiptUrl(url);
  if (
    metadata !== undefined &&
    !isNonArrayObject(metadata)
  ) {
    throw EXTENSION_VALIDATION_ERROR.create({
      message: "Eval report export receipt metadata must be an object",
    });
  }
  const metadataSnapshot = metadata === undefined
    ? undefined
    : cloneJsonSafeReceiptMetadata(metadata);
  return {
    ...(externalRunId !== undefined ? { externalRunId } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(metadataSnapshot !== undefined ? { metadata: metadataSnapshot } : {}),
  } as EvalReportExportReceipt;
}
