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

/**
 * Inspect the basic OKF document contract at the pinned revision.
 *
 * Unknown types and metadata are accepted. Legacy files remain readable with
 * diagnostics. This checks the document envelope, not the complete optional
 * provenance or Attested Computation contracts, and does not resolve links.
 */
export function inspectOkfDocument(path: string, source: string): OkfDocumentInspection {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const kind = name === "index.md" ? "index" : name === "log.md" ? "log" : "concept";
  // Unlike the compiler's permissive matcher, OKF delimiters occupy whole lines.
  // Inline dashes remain part of the YAML value instead of closing the envelope.
  const matched = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  const framed = matched ? { frontMatter: matched[1] ?? "", body: matched[2] ?? "" } : undefined;
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
      // JSON resolution preserves timestamp strings instead of coercing them
      // into Date objects during the read side of an import/export cycle.
      const decoded = framed.frontMatter.trim()
        ? parse(framed.frontMatter, { schema: "json" })
        : {};
      if (
        !decoded || typeof decoded !== "object" || Array.isArray(decoded) ||
        (Object.getPrototypeOf(decoded) !== Object.prototype &&
          Object.getPrototypeOf(decoded) !== null)
      ) {
        throw new TypeError("Expected a YAML mapping");
      }
      metadata = decoded as Record<string, unknown>;
      if (kind === "concept") {
        const type = Object.getOwnPropertyDescriptor(metadata, "type")?.value;
        if (type === undefined) {
          diagnostics.push({
            code: "missing_type",
            message: "Add a non-empty type to the frontmatter.",
          });
        } else if (typeof type !== "string" || !type.trim()) {
          diagnostics.push({ code: "invalid_type", message: "Set type to a non-empty string." });
        }
      }
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
