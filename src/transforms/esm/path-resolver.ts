import { replaceSpecifiers } from "./lexer.ts";
import { withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isCrossProjectImport,
  parseCrossProjectImport,
} from "#veryfront/transforms/shared/cross-project-import.ts";

export { isCrossProjectImport, parseCrossProjectImport };

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
