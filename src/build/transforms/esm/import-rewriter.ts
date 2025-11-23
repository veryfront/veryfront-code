import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";

export function rewriteBareImports(code: string, moduleServerUrl?: string): string {
  const importMap: Record<string, string> = moduleServerUrl
    ? {
      "react": `${moduleServerUrl}/_vendor/react`,
      "react-dom": `${moduleServerUrl}/_vendor/react-dom`,
      "react-dom/client": `${moduleServerUrl}/_vendor/react-dom/client`,
      "react-dom/server": `${moduleServerUrl}/_vendor/react-dom/server`,
      "react/jsx-runtime": `${moduleServerUrl}/_vendor/react/jsx-runtime`,
      "react/jsx-dev-runtime": `${moduleServerUrl}/_vendor/react/jsx-dev-runtime`,
    }
    : {
      "react": `https://esm.sh/react@${REACT_DEFAULT_VERSION}`,
      "react-dom": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}`,
      "react-dom/client": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/client`,
      "react-dom/server": `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`,
      "react/jsx-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
      "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
    };

  for (const [bare, url] of Object.entries(importMap)) {
    const importRegex = new RegExp(
      `from\\s*['"]${bare.replace(/\//g, "\\/")}['"]`,
      "g",
    );
    code = code.replace(importRegex, `from '${url}'`);

    const dynamicImportRegex = new RegExp(
      `import\\(['"]${bare.replace(/\//g, "\\/")}['"]\\)`,
      "g",
    );
    code = code.replace(dynamicImportRegex, `import('${url}')`);
  }

  return code;
}

export function rewriteVendorImports(
  code: string,
  moduleServerUrl: string,
  vendorBundleHash: string,
): string {
  const vendorUrl = `${moduleServerUrl}/_vendor.js?v=${vendorBundleHash}`;

  const reactPackages = [
    "react",
    "react-dom",
    "react-dom/client",
    "react-dom/server",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ];

  for (const pkg of reactPackages) {
    const exportName = sanitizeVendorExportName(pkg);

    const patterns = [
      `['"]${pkg.replace(/\//g, "\\/")}['"]`,
      `['"]https://esm\\.sh/${pkg.replace(/\//g, "\\/")}@[^'"]+['"]`,
      `['"]https://esm\\.sh/${pkg.replace(/\//g, "\\/")}['"]`,
    ];

    for (const pattern of patterns) {
      const importRegex = new RegExp(
        `import\\s+([^'"]+)\\s+from\\s+${pattern}`,
        "g",
      );

      code = code.replace(importRegex, (_match, imports) => {
        if (imports.trim().startsWith("*")) {
          return `import ${imports} from '${vendorUrl}'`;
        }

        if (imports.trim().startsWith("{")) {
          return `import { ${exportName} } from '${vendorUrl}'; const ${imports.trim()} = ${exportName}`;
        }

        return `import { ${exportName} as ${imports.trim()} } from '${vendorUrl}'`;
      });
    }

    const dynamicPatterns = [
      `import\\(['"]${pkg.replace(/\//g, "\\/")}['"]\\)`,
      `import\\(['"]https://esm\\.sh/${pkg.replace(/\//g, "\\/")}@[^'"]+['"]\\)`,
      `import\\(['"]https://esm\\.sh/${pkg.replace(/\//g, "\\/")}['"]\\)`,
    ];

    for (const pattern of dynamicPatterns) {
      const dynamicImportRegex = new RegExp(pattern, "g");
      code = code.replace(
        dynamicImportRegex,
        `import('${vendorUrl}').then(m => m.${exportName})`,
      );
    }
  }

  return code;
}

function sanitizeVendorExportName(pkg: string): string {
  return pkg
    .replace(/^@/, "") // Remove @ prefix
    .replace(/[\/\-]/g, "_") // Replace / and - with _
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) // camelCase
    .replace(/^_/, ""); // Remove leading underscore
}
