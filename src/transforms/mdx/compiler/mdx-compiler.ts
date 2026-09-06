import { rendererLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type {
  CompilationMode,
  CompilationTarget,
  ContentProcessingResult,
  ContentProcessor,
} from "#veryfront/extensions/content/index.ts";
import { MDX_COMPILE_ERROR, VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isFrontmatterSyntaxError } from "./frontmatter-extractor.ts";

const logger = rendererLogger.component("mdx-compiler");
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

function readOwnDataProperty(value: Error, key: PropertyKey): unknown {
  try {
    const descriptor = ReflectGetOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true
    ) {
      return descriptor.value;
    }
  } catch {
    // A hostile proxy cannot provide trusted source-diagnostic evidence.
  }
  return undefined;
}

function isMdxSourceCompileError(error: Error): boolean {
  const source = readOwnDataProperty(error, "source");
  const ruleId = readOwnDataProperty(error, "ruleId");
  const line = readOwnDataProperty(error, "line");
  const column = readOwnDataProperty(error, "column");
  const isMdxParserError = typeof source === "string" &&
    /(?:^|-)mdx(?:-|$)|micromark|remark|recma|rehype/.test(source) &&
    typeof ruleId === "string" &&
    Number.isSafeInteger(line) &&
    Number.isSafeInteger(column);
  // Frontmatter failures are identified by the symbol `extractFrontmatter`
  // stamps at the throw site, not by matching stack-frame paths: `extract()` is
  // the only frontmatter path and it tags every SyntaxError it raises. A
  // stack-path heuristic would only add false positives (any SyntaxError whose
  // stack happened to pass through the YAML shim) and does not survive
  // `deno compile` anyway.
  return isMdxParserError || isFrontmatterSyntaxError(error);
}

export function compileMDXRuntime(
  mode: CompilationMode,
  projectDir: string,
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
  target: CompilationTarget = "server",
  baseUrl?: string,
  studioEmbed?: boolean,
  preserveImports?: boolean,
): Promise<ContentProcessingResult> {
  return withSpan(
    "transforms.compileMDXRuntime",
    async () => {
      try {
        const processor = resolveContract<ContentProcessor>("ContentProcessor");
        return await processor.compileMdx({
          mode,
          projectDir,
          content,
          frontmatter,
          filePath,
          target,
          baseUrl,
          studioEmbed,
          ...(preserveImports === undefined ? {} : { preserveImports }),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Compilation failed:", {
          filePath,
          error: err.message,
          stack: err.stack,
        });

        if (err instanceof VeryfrontError || !isMdxSourceCompileError(err)) {
          throw err;
        }

        throw MDX_COMPILE_ERROR.create({
          detail: `MDX compilation error: ${err.message} | file: ${filePath ?? "<memory>"}`,
          cause: err,
        });
      }
    },
    {
      "mdx.filePath": filePath ?? "memory",
      "mdx.target": target,
      "mdx.contentLength": content.length,
    },
  );
}
