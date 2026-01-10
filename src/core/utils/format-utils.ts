import { logger } from "./logger/logger.ts";

const BYTE_SIZES = ["Bytes", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const absBytes = Math.abs(bytes);
  if (absBytes < 1) return `${absBytes} Bytes`;

  const i = Math.min(
    Math.floor(Math.log(absBytes) / Math.log(1024)),
    BYTE_SIZES.length - 1,
  );

  return `${parseFloat((absBytes / Math.pow(1024, i)).toFixed(2))} ${BYTE_SIZES[i]}`;
}

export function estimateSize(value: unknown): number {
  if (value == null) return 8;

  switch (typeof value) {
    case "boolean":
      return 4;
    case "number":
      return 8;
    case "string":
      return value.length * 2; // UTF-16
    case "function":
      return 0; // Functions not cached
    case "object":
      return estimateObjectSize(value);
    default:
      return 32;
  }
}

export function estimateSizeWithCircularHandling(value: unknown): number {
  const seen = new WeakSet();
  const encoder = new TextEncoder();

  const json = JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val as object)) return undefined;
      seen.add(val as object);

      if (val instanceof Map) {
        return { __type: "Map", entries: Array.from(val.entries()) };
      }
      if (val instanceof Set) {
        return { __type: "Set", values: Array.from(val.values()) };
      }
    }

    if (typeof val === "function") return undefined;

    if (val instanceof Uint8Array) {
      return { __type: "Uint8Array", length: val.length };
    }

    return val;
  });

  return encoder.encode(json ?? "").length;
}

function estimateObjectSize(value: object): number {
  if (value instanceof ArrayBuffer) return value.byteLength;

  if (
    value instanceof Uint8Array || value instanceof Uint16Array ||
    value instanceof Uint32Array || value instanceof Int8Array ||
    value instanceof Int16Array || value instanceof Int32Array
  ) {
    return value.byteLength;
  }

  try {
    return JSON.stringify(value).length * 2;
  } catch (error) {
    logger.debug("Failed to estimate size of non-serializable object:", error);
    return 1024; // Default estimate for non-serializable
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
