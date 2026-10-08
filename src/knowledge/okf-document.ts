/** Read-only inspection of portable OKF documents and existing knowledge files. */
import { parse } from "#std/yaml/parse";

/** Immutable upstream revision used by this reader's conformance checks. */
export const OKF_SPEC_REVISION = "ad30107c31c06aec8a7d5636e0d1058118604e6f";
/** Supported canonical OKF version. Existing documents are never migrated implicitly. */
export const OKF_SPEC_VERSION = "0.2";

/** An actionable source defect, rather than a reason to discard document content. */
export interface OkfDocumentDiagnostic {
  code: "missing_frontmatter" | "invalid_frontmatter" | "missing_type" | "invalid_type";
  message: string;
}

/** Lossless source plus decoded metadata; inspection does not serialize or edit YAML. */
export interface OkfDocumentInspection {
  path: string;
  source: string;
  body: string;
  metadata: Record<string, unknown>;
  kind: "concept" | "index" | "log";
  envelopeConforms: boolean;
  diagnostics: OkfDocumentDiagnostic[];
}

export function isRuntimeCapabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.name === "NotCapable" &&
    /^Requires (?:read|write|env|net|run|ffi|sys) access\b/.test(error.message)
  ) {
    return true;
  }
  const cause = Object.getOwnPropertyDescriptor(error, "cause")?.value;
  return isRuntimeCapabilityError(cause);
}

function getOkfDocumentKind(path: string): OkfDocumentInspection["kind"] {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "index.md") return "index";
  if (name === "log.md") return "log";
  return "concept";
}

function readOkfEnvelope(source: string) {
  const opening = /^---\r?\n/.exec(source);
  if (!opening) return undefined;
  const remainder = source.slice(opening[0].length);
  const closing = /(?:^|\r?\n)---(?:\r?\n|(?![\s\S]))/.exec(remainder);
  if (!closing) return undefined;
  return {
    frontMatter: remainder.slice(0, closing.index),
    body: remainder.slice(closing.index + closing[0].length),
  };
}

function decodeOkfMetadata(frontMatter: string): Record<string, unknown> {
  // JSON resolution preserves timestamp strings instead of coercing them to Date.
  const decoded: unknown = frontMatter.trim() ? parse(frontMatter, { schema: "json" }) : {};
  if (
    !decoded || typeof decoded !== "object" || Array.isArray(decoded) ||
    (Object.getPrototypeOf(decoded) !== Object.prototype && Object.getPrototypeOf(decoded) !== null)
  ) {
    throw new TypeError("Expected a YAML mapping");
  }
  return decoded as Record<string, unknown>;
}

function getOkfTypeDiagnostic(
  metadata: Record<string, unknown>,
): OkfDocumentDiagnostic | undefined {
  const type = Object.getOwnPropertyDescriptor(metadata, "type")?.value;
  if (type === undefined) {
    return { code: "missing_type", message: "Add a non-empty type to the frontmatter." };
  }
  if (typeof type !== "string" || !type.trim()) {
    return { code: "invalid_type", message: "Set type to a non-empty string." };
  }
  return undefined;
}

/**
 * Inspect the basic OKF document contract at the pinned revision.
 *
 * Unknown types and metadata are accepted. Legacy files remain readable with
 * diagnostics. This checks the document envelope, not the complete optional
 * provenance or Attested Computation contracts, and does not resolve links.
 */
export function inspectOkfDocument(path: string, source: string): OkfDocumentInspection {
  const kind = getOkfDocumentKind(path);
  const framed = readOkfEnvelope(source);
  const diagnostics: OkfDocumentDiagnostic[] = [];
  let metadata: Record<string, unknown> = {};

  if (!framed) {
    if (/^---\r?\n/.test(source)) {
      diagnostics.push({
        code: "invalid_frontmatter",
        message: "Close the leading YAML frontmatter with a line containing ---.",
      });
    } else if (kind === "concept") {
      diagnostics.push({
        code: "missing_frontmatter",
        message: "Add leading YAML frontmatter containing a non-empty type.",
      });
    }
  } else {
    try {
      metadata = decodeOkfMetadata(framed.frontMatter);
      const diagnostic = kind === "concept" ? getOkfTypeDiagnostic(metadata) : undefined;
      if (diagnostic) diagnostics.push(diagnostic);
    } catch (error) {
      if (isRuntimeCapabilityError(error)) throw error;
      diagnostics.push({
        code: "invalid_frontmatter",
        message: "Use one valid YAML mapping between the frontmatter delimiters.",
      });
    }
  }

  return {
    path,
    source,
    body: framed?.body ?? source,
    metadata,
    kind,
    envelopeConforms: diagnostics.length === 0,
    diagnostics,
  };
}
