import { INVALID_ARGUMENT } from "#veryfront/errors";
import { basename, join } from "#veryfront/platform/compat/path/basic-operations.ts";

function stripTrailingSlashes(path: string): string {
  const normalized = join(path);
  if (normalized === "/" || /^[a-z]:\/$/i.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, "");
}

/** Builds a stable source identifier for a file below a configured content directory. */
export function buildContentFileSource(
  contentDir: string,
  filePath: string,
  options: { preserveContentDir?: boolean } = {},
): { relativeSource: string; source: string } {
  const normalizedDir = stripTrailingSlashes(contentDir);
  const normalizedFile = join(filePath);
  let relativeSource: string;

  if (normalizedDir === ".") {
    if (normalizedFile.startsWith("../") || normalizedFile.startsWith("/")) {
      throw INVALID_ARGUMENT.create({
        detail: "RAG content file is outside the configured directory",
      });
    }
    relativeSource = normalizedFile;
  } else {
    const prefix = normalizedDir.endsWith("/") ? normalizedDir : `${normalizedDir}/`;
    if (!normalizedFile.startsWith(prefix)) {
      throw INVALID_ARGUMENT.create({
        detail: "RAG content file is outside the configured directory",
      });
    }
    relativeSource = normalizedFile.slice(prefix.length);
  }

  if (!relativeSource || relativeSource === "." || relativeSource.startsWith("../")) {
    throw INVALID_ARGUMENT.create({
      detail: "RAG content file is outside the configured directory",
    });
  }

  const sourceRoot = options.preserveContentDir ? normalizedDir : basename(normalizedDir);
  return {
    relativeSource,
    source: sourceRoot && sourceRoot !== "." ? join(sourceRoot, relativeSource) : relativeSource,
  };
}
