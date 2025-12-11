import { parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";

export function rewriteBareImports(code: string, _moduleServerUrl?: string): Promise<string> {
  const importMap: Record<string, string> = {
    "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
    "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    // NOTE: veryfront/ai/react is NOT rewritten here - it's handled by the HTML import map
  };

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    return importMap[specifier] || null;
  }));
}

export async function rewriteVendorImports(
  code: string,
  moduleServerUrl: string,
  vendorBundleHash: string,
): Promise<string> {
  const vendorUrl = `${moduleServerUrl}/_vendor.js?v=${vendorBundleHash}`;

  const reactPackages = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);

  let result = await rewriteImports(code, (imp, statement) => {
    if (!imp.n || !reactPackages.has(imp.n)) return null;
    const trimmed = statement.trimStart();
    if (!trimmed.startsWith("export")) return null;

    const specStart = imp.s - imp.ss;
    const specEnd = imp.e - imp.ss;
    const before = statement.slice(0, specStart);
    const after = statement.slice(specEnd);
    return `${before}${vendorUrl}${after}`;
  });

  const baseSource = result;
  const imports = await parseImports(baseSource);

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;

    if (!imp.n || !reactPackages.has(imp.n)) continue;

    const exportName = sanitizeVendorExportName(imp.n);

    if (imp.d > -1) {

      const afterSpecifier = baseSource.substring(imp.e);
      const match = afterSpecifier.match(/^['"]\s*\)/);

      if (!match) continue;

      const endOfCall = imp.e + match[0].length;

      const before = result.substring(0, imp.d);
      const after = result.substring(endOfCall);
      const replacement = `import('${vendorUrl}').then(m => m.${exportName})`;

      result = before + replacement + after;
    } else {
      const beforeSpecifier = baseSource.substring(imp.ss, imp.s);
      const fromIndex = beforeSpecifier.lastIndexOf("from");

      if (fromIndex === -1) {
        const before = result.substring(0, imp.ss);
        const after = result.substring(imp.se);
        result = before + `import '${vendorUrl}'` + after;
        continue;
      }

      const clause = beforeSpecifier.substring(6, fromIndex).trim();

      let replacement = "";
      if (clause.startsWith("*")) {
        replacement = `import ${clause} from '${vendorUrl}'`;
      } else if (clause.startsWith("{")) {
        replacement =
          `import { ${exportName} } from '${vendorUrl}'; const ${clause} = ${exportName}`;
      } else {
        replacement = `import { ${exportName} as ${clause} } from '${vendorUrl}'`;
      }

      const before = result.substring(0, imp.ss);
      const after = result.substring(imp.se);
      result = before + replacement + after;
    }
  }

  return result;
}

function sanitizeVendorExportName(pkg: string): string {
  return pkg
    .replace(/^@/, "")
    .replace(/[\/\-]/g, "_")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^_/, "");
}
