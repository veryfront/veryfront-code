import type { Resource } from "./types.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { encodeBase64Bytes } from "#veryfront/utils/base64url.ts";

const MAX_RESOURCE_CONTENT_BYTES = 4 * 1024 * 1024;
const JsonStringify = JSON.stringify.bind(JSON);
const TextEncoderConstructor = TextEncoder;
const Uint8ArrayConstructor = Uint8Array;

export type MCPResourceContents =
  | {
    readonly uri: string;
    readonly mimeType: string;
    readonly text: string;
  }
  | {
    readonly uri: string;
    readonly mimeType: string;
    readonly blob: string;
  };

/** Error raised when a loader result cannot satisfy its declared MCP mode. */
export class ResourceContentValidationError extends Error {
  readonly resourceId: string;
  readonly contentType: "json" | "text" | "blob";

  constructor(
    resourceId: string,
    contentType: "json" | "text" | "blob",
  ) {
    super(
      contentType === "json"
        ? `Resource "${resourceId}" returned data that is not bounded JSON`
        : `Resource "${resourceId}" returned invalid ${contentType} content`,
    );
    this.name = "ResourceContentValidationError";
    this.resourceId = resourceId;
    this.contentType = contentType;
  }
}

/** MIME type advertised for every result of one resource definition. */
export function getResourceMCPMimeType(resource: Resource): string {
  const content = resource.mcp?.content;
  return content === undefined || content.type === "json" ? "application/json" : content.mimeType;
}

/** Convert one loader result into a bounded MCP text or blob content item. */
export function toMCPResourceContents(
  resourceId: string,
  resource: Resource,
  data: unknown,
  uri: string,
): MCPResourceContents {
  const content = resource.mcp?.content;

  if (content === undefined || content.type === "json") {
    const snapshot = snapshotBoundedJsonValue(data);
    if (!snapshot.success) {
      throw new ResourceContentValidationError(resourceId, "json");
    }
    const text = JsonStringify(snapshot.value);
    if (
      text === undefined ||
      new TextEncoderConstructor().encode(text).byteLength >
        MAX_RESOURCE_CONTENT_BYTES
    ) {
      throw new ResourceContentValidationError(resourceId, "json");
    }
    return {
      uri,
      mimeType: "application/json",
      text,
    };
  }

  if (content.type === "text") {
    if (
      typeof data !== "string" ||
      data.length > MAX_RESOURCE_CONTENT_BYTES ||
      new TextEncoderConstructor().encode(data).byteLength > MAX_RESOURCE_CONTENT_BYTES
    ) {
      throw new ResourceContentValidationError(resourceId, "text");
    }
    return {
      uri,
      mimeType: content.mimeType,
      text: data,
    };
  }

  if (
    !(data instanceof Uint8ArrayConstructor) ||
    data.byteLength > MAX_RESOURCE_CONTENT_BYTES
  ) {
    throw new ResourceContentValidationError(resourceId, "blob");
  }
  const snapshot = new Uint8ArrayConstructor(data);
  return {
    uri,
    mimeType: content.mimeType,
    blob: encodeBase64Bytes(snapshot),
  };
}
