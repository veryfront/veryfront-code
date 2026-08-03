import { CLIENT_BOUNDARY_VIOLATION } from "#veryfront/errors/index.ts";
import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path/index.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ClientModuleStrategy } from "./client-module-strategy.ts";

export const CLIENT_PAGE_ISLAND_ID = "veryfront-page-island";

export interface ClientPageIslandLayout {
  kind: "mdx" | "tsx";
  path: string;
}

export interface ClientPageIslandPlan {
  serverLayouts: ClientPageIslandLayout[];
  clientLayouts: ClientPageIslandLayout[];
}

export interface ClientPageIslandPlanOptions {
  pageSource: string;
  pagePath: string;
  projectDir: string;
  appDir: string;
  layouts: readonly ClientPageIslandLayout[];
  fs: FileSystemAdapter | null | undefined;
  strategy: ClientModuleStrategy;
}

const SCRIPT_EXTENSION_PATTERN = /\.(?:tsx?|jsx?)$/i;

interface TriviaScan {
  index: number;
  sawLineTerminator: boolean;
  valid: boolean;
}

interface StringLiteralScan {
  end: number;
  value: string | null;
}

function isLineTerminator(character: string): boolean {
  return character === "\n" ||
    character === "\r" ||
    character === "\u2028" ||
    character === "\u2029";
}

function scanTrivia(source: string, start: number): TriviaScan {
  let index = start;
  let sawLineTerminator = false;

  while (index < source.length) {
    const character = source[index]!;
    if (/\s/u.test(character)) {
      sawLineTerminator ||= isLineTerminator(character);
      index += 1;
      continue;
    }

    if (source.startsWith("//", index)) {
      index += 2;
      while (index < source.length && !isLineTerminator(source[index]!)) index += 1;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd === -1) return { index: source.length, sawLineTerminator, valid: false };

      for (let commentIndex = index + 2; commentIndex < commentEnd; commentIndex += 1) {
        if (isLineTerminator(source[commentIndex]!)) sawLineTerminator = true;
      }
      index = commentEnd + 2;
      continue;
    }

    break;
  }

  return { index, sawLineTerminator, valid: true };
}

function scanStringLiteral(source: string, start: number): StringLiteralScan | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return null;

  let index = start + 1;
  let hasEscape = false;
  while (index < source.length) {
    const character = source[index]!;
    if (character === quote) {
      return {
        end: index + 1,
        value: hasEscape ? null : source.slice(start + 1, index),
      };
    }
    if (isLineTerminator(character)) return null;
    if (character === "\\") {
      hasEscape = true;
      index += 2;
      continue;
    }
    index += 1;
  }

  return null;
}

function canContinueStringExpression(source: string, index: number): boolean {
  if ("([.`?+-*/%<>=!&|^,".includes(source[index]!)) return true;

  const word = /^[A-Za-z_$][\w$]*/u.exec(source.slice(index))?.[0];
  return word === "as" ||
    word === "in" ||
    word === "instanceof" ||
    word === "satisfies";
}

function hasDirectivePrologue(
  source: string,
  directive: "use client" | "use server",
): boolean {
  let index = source.charCodeAt(0) === 0xFEFF ? 1 : 0;
  if (source.startsWith("#!", index)) {
    while (index < source.length && !isLineTerminator(source[index]!)) index += 1;
  }

  const leadingTrivia = scanTrivia(source, index);
  if (!leadingTrivia.valid) return false;
  index = leadingTrivia.index;

  while (index < source.length) {
    const literal = scanStringLiteral(source, index);
    if (!literal) return false;

    const trailingTrivia = scanTrivia(source, literal.end);
    if (!trailingTrivia.valid) return false;

    let nextIndex = trailingTrivia.index;
    if (source[nextIndex] === ";") {
      const nextTrivia = scanTrivia(source, nextIndex + 1);
      if (!nextTrivia.valid) return false;
      nextIndex = nextTrivia.index;
    } else if (
      nextIndex < source.length &&
      (!trailingTrivia.sawLineTerminator || canContinueStringExpression(source, nextIndex))
    ) {
      return false;
    }

    if (literal.value === directive) return true;
    index = nextIndex;
  }

  return false;
}

export function hasClientFileName(path: string | undefined): boolean {
  const fileName = path?.split(/[\\/]/).at(-1);
  return fileName?.includes(".client.") === true;
}

/** Match the client classification used by the RSC component analyzer. */
export function hasUseClientDirective(source: string, path?: string): boolean {
  return hasDirectivePrologue(source, "use client") || hasClientFileName(path);
}

/** Detect a top-level server boundary using directive-prologue semantics. */
export function hasUseServerDirective(source: string): boolean {
  return hasDirectivePrologue(source, "use server");
}

function isPathInside(path: string, directory: string): boolean {
  const relativePath = relative(directory, path).replaceAll("\\", "/");
  return relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !isAbsolute(relativePath);
}

function isAppRouterPath(pagePath: string, projectDir: string, appDir: string): boolean {
  const projectRoot = normalize(projectDir);
  const appRoot = normalize(isAbsolute(appDir) ? appDir : join(projectRoot, appDir));
  const pageFile = normalize(isAbsolute(pagePath) ? pagePath : join(projectRoot, pagePath));

  if (isPathInside(pageFile, appRoot)) return true;

  // Hydration paths can be project-relative while retaining a leading slash.
  const projectRelativePage = normalize(join(projectRoot, pagePath.replace(/^[/\\]+/, "")));
  return isPathInside(projectRelativePage, appRoot);
}

async function isClientLayout(
  layout: ClientPageIslandLayout,
  fs: FileSystemAdapter,
): Promise<boolean> {
  if (layout.kind === "mdx" || !SCRIPT_EXTENSION_PATTERN.test(layout.path)) return false;

  try {
    const source = await fs.readFile(layout.path);
    return hasUseClientDirective(source, layout.path);
  } catch {
    return false;
  }
}

function projectRelativePath(path: string, projectDir: string): string {
  const normalized = relative(projectDir, path).replaceAll("\\", "/");
  return normalized.startsWith("../") || isAbsolute(normalized)
    ? path.split(/[\\/]/).at(-1) ?? path
    : normalized;
}

/**
 * Split App Router layouts around the single legal server-to-client boundary.
 * Read failures remain on the server side so an uncertain layout is never
 * promoted into browser code.
 */
export async function planClientPageIsland(
  options: ClientPageIslandPlanOptions,
): Promise<ClientPageIslandPlan | null> {
  const { pageSource, pagePath, projectDir, appDir, layouts, fs, strategy } = options;
  if (
    strategy !== "rsc-module" ||
    !fs ||
    !hasUseClientDirective(pageSource, pagePath) ||
    !isAppRouterPath(pagePath, projectDir, appDir)
  ) {
    return null;
  }

  const serverLayouts: ClientPageIslandLayout[] = [];
  const clientLayouts: ClientPageIslandLayout[] = [];
  let firstClientLayout: ClientPageIslandLayout | undefined;

  for (const layout of layouts) {
    if (await isClientLayout(layout, fs)) {
      firstClientLayout ??= layout;
      clientLayouts.push(layout);
      continue;
    }

    if (firstClientLayout) {
      throw CLIENT_BOUNDARY_VIOLATION.create({
        detail:
          "A server layout cannot appear below a client layout. Move every server layout above the first client layout.",
        context: {
          pagePath: projectRelativePath(pagePath, projectDir),
          clientLayoutPath: projectRelativePath(firstClientLayout.path, projectDir),
          serverLayoutPath: projectRelativePath(layout.path, projectDir),
        },
      });
    }

    serverLayouts.push(layout);
  }

  return { serverLayouts, clientLayouts };
}
