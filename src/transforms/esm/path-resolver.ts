import { replaceSpecifiers } from "./lexer.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { stat } from "#veryfront/platform/compat/fs.ts";
import { withSpan, withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isCrossProjectImport,
  parseCrossProjectImport,
} from "#veryfront/transforms/shared/cross-project-import.ts";

export interface BlockExternalUrlResult {
  code: string;
  blockedUrls: string[];
}

export { isCrossProjectImport, parseCrossProjectImport };

export interface CrossProjectImportOptions {
  apiBaseUrl?: string;
  ssr?: boolean;
}

export function resolveCrossProjectImports(
  code: string,
  options: CrossProjectImportOptions,
): Promise<string> {
  return Promise.resolve(
    withSpanSync(
      "transforms.esm.resolveCrossProjectImports",
      () => {
        if (options.ssr ?? false) return code;

        return replaceSpecifiers(code, (specifier) => {
          const parsed = parseCrossProjectImport(specifier);
          if (!parsed) return null;

          const { projectSlug, version, path } = parsed;

          const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
          const projectRef = version === "latest" ? projectSlug : `${projectSlug}@${version}`;
          const moduleServerUrl = `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;

          logger.debug("[CrossProjectImport] Rewriting", { from: specifier, to: moduleServerUrl });

          return moduleServerUrl;
        });
      },
      { "transforms.ssr": options.ssr ?? false },
    ),
  );
}

export function blockExternalUrlImports(
  code: string,
  _filePath: string,
): Promise<BlockExternalUrlResult> {
  return Promise.resolve({ code, blockedUrls: [] });
}

export function resolveVeryfrontSubpathImports(code: string, ssr = false): Promise<string> {
  if (ssr) return Promise.resolve(code);

  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      if (!specifier.startsWith("#veryfront/")) return null;

      const path = specifier.substring("#veryfront/".length);
      const normalizedPath = path.replace(/\.(tsx?|jsx)$/, ".js");
      return `/_vf_modules/_veryfront/${normalizedPath}`;
    }),
  );
}

function getRelativeFilePath(filePath: string, normalizedProjectDir: string): string {
  if (filePath.startsWith(normalizedProjectDir)) {
    return filePath.substring(normalizedProjectDir.length + 1);
  }

  if (!filePath.startsWith("/")) return filePath;

  const pathParts = filePath.split("/");
  const projectParts = normalizedProjectDir.split("/");
  const lastProjectPart = projectParts[projectParts.length - 1];
  const projectIndex = lastProjectPart ? pathParts.indexOf(lastProjectPart) : -1;

  if (projectIndex >= 0) {
    return pathParts.slice(projectIndex + 1).join("/");
  }

  return filePath;
}

export function resolvePathAliases(
  code: string,
  filePath: string,
  projectDir: string,
  ssr = false,
): Promise<string> {
  return Promise.resolve(
    withSpanSync(
      "transforms.esm.resolvePathAliases",
      () => {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        const relativeFilePath = getRelativeFilePath(filePath, normalizedProjectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
        const depth = fileDir.split("/").filter(Boolean).length;
        const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);

        return replaceSpecifiers(code, (specifier) => {
          if (!specifier.startsWith("@/")) return null;

          const path = specifier.substring(2);
          const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;

          if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
            return `${relativePath}.js`;
          }

          if (ssr) return relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");

          return relativePath;
        });
      },
      { "transforms.ssr": ssr },
    ),
  );
}

export function resolveRelativeImports(
  code: string,
  filePath: string,
  projectDir: string,
  moduleServerUrl?: string,
): Promise<string> {
  return Promise.resolve(
    withSpanSync(
      "transforms.esm.resolveRelativeImports",
      () => {
        const normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");
        const relativeFilePath = getRelativeFilePath(filePath, normalizedProjectDir);
        const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));

        return replaceSpecifiers(code, (specifier) => {
          if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

          const rewrittenSpecifier = /\.(tsx?|jsx)$/.test(specifier)
            ? specifier.replace(/\.(tsx?|jsx)$/, ".js")
            : specifier;

          if (!moduleServerUrl) return rewrittenSpecifier;

          const resolvedPath = resolveRelativePath(fileDir, rewrittenSpecifier);
          return `${moduleServerUrl}/${resolvedPath}`;
        });
      },
      { "transforms.has_module_server": !!moduleServerUrl },
    ),
  );
}

function resolveRelativePath(currentDir: string, importPath: string): string {
  return resolvePath(currentDir.split("/").filter(Boolean), importPath).join("/");
}

function resolvePath(baseParts: string[], relativePath: string): string[] {
  const resolvedParts = [...baseParts];

  for (const part of relativePath.split("/").filter(Boolean)) {
    if (part === "..") {
      resolvedParts.pop();
      continue;
    }
    if (part === ".") continue;
    resolvedParts.push(part);
  }

  return resolvedParts;
}

export function resolveRelativeImportsToAbsolute(
  code: string,
  filePath: string,
  _projectDir: string,
): Promise<string> {
  return withSpan(
    "transforms.esm.resolveRelativeImportsToAbsolute",
    async () => {
      const normalizedFilePath = filePath.replace(/\\/g, "/");
      const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));

      const specifiersToResolve: string[] = [];
      await replaceSpecifiers(code, (specifier) => {
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          specifiersToResolve.push(specifier);
        }
        return null;
      });

      const resolvedImports = new Map<string, string>();
      for (const specifier of specifiersToResolve) {
        const absolutePath = resolveAbsolutePath(fileDir, specifier);
        const resolvedPath = await findFileWithExtension(absolutePath);
        resolvedImports.set(specifier, `file://${resolvedPath}`);
      }

      return replaceSpecifiers(code, (specifier) => resolvedImports.get(specifier) ?? null);
    },
    { "transforms.specifiers_count": 0 },
  );
}

async function findFileWithExtension(basePath: string): Promise<string> {
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(basePath)) return basePath;

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    try {
      const fileStat = await stat(fullPath);
      if (fileStat.isFile) return fullPath;
    } catch {
      // ignore
    }
  }

  return basePath + ".ts";
}

export function resolveRelativeImportsForNodeSSR(code: string): Promise<string> {
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
      return specifier.replace(/\.(tsx|ts|jsx)$/, ".js");
    }),
  );
}

export function resolveRelativeImportsForSSR(code: string): Promise<string> {
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
      if (/\.(js|mjs|cjs)$/.test(specifier)) return null;

      const withoutExt = specifier.replace(/\.(tsx?|jsx|mdx)$/, "");
      return `${withoutExt}.js`;
    }),
  );
}

function resolveAbsolutePath(baseDir: string, relativePath: string): string {
  return `/${resolvePath(baseDir.split("/").filter(Boolean), relativePath).join("/")}`;
}
