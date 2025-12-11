
import * as esbuild from "esbuild";
import { createError, toError } from "../core/errors/veryfront-error.ts";

export interface VendorBundleConfig {
  projectId: string;
  reactVersion: string;
  dependencies: Record<string, string>;
  dev?: boolean;
}

export interface VendorBundleResult {
  code: string;
  hash: string;
  exports: Record<string, string>;
}

export async function buildVendorBundle(
  config: VendorBundleConfig,
): Promise<VendorBundleResult> {
  const { reactVersion, dependencies, dev = true } = config;

  const reactImports = {
    "react": `https://esm.sh/react@${reactVersion}?pin=v135`,
    "react-dom": `https://esm.sh/react-dom@${reactVersion}?pin=v135`,
    "react-dom/server": `https://esm.sh/react-dom@${reactVersion}/server?pin=v135`,
    "react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client?pin=v135`,
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime?pin=v135`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${reactVersion}/jsx-dev-runtime?pin=v135`,
  };

  const thirdPartyImports: Record<string, string> = {};
  for (const [pkg, version] of Object.entries(dependencies)) {
    thirdPartyImports[pkg] = `https://esm.sh/${pkg}@${version}?external=react,react-dom&pin=v135`;
  }

  const entryPoint = createVirtualEntry({
    ...reactImports,
    ...thirdPartyImports,
  });

  const result = await esbuild.build({
    stdin: {
      contents: entryPoint,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    treeShaking: true,
    write: false,
  });

  if (result.outputFiles.length === 0) {
    throw toError(createError({
      type: "build",
      message: "Vendor bundle build produced no output",
    }));
  }

  const code = new TextDecoder().decode(result.outputFiles[0]!.contents);

  const hash = await computeHash(code);

  const exports: Record<string, string> = {};
  for (const key of Object.keys({ ...reactImports, ...thirdPartyImports })) {
    exports[key] = sanitizeExportName(key);
  }

  return { code, hash, exports };
}

function createVirtualEntry(imports: Record<string, string>): string {
  const lines: string[] = [];

  for (const [specifier, url] of Object.entries(imports)) {
    const exportName = sanitizeExportName(specifier);
    lines.push(`import * as ${exportName} from '${url}';`);
  }

  const exportNames = Object.keys(imports).map(sanitizeExportName);

  lines.push(`export { ${exportNames.join(", ")} };`);

  return lines.join("\n");
}

function sanitizeExportName(specifier: string): string {
  return specifier
    .replace(/^@/, "")
    .replace(/[\/\-]/g, "_")
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^_/, "");
}

async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}
