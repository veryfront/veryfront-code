import type { LightningCSSOptions } from "./types.ts";
import { parseBrowserTargets } from "../css-optimizer/utils.ts";
import { hasTailwindV4Import } from "./detector.ts";

export async function processWithLightningCSS(
  css: string,
  options: LightningCSSOptions,
): Promise<string> {
  if (options.sourceMap) {
    throw new TypeError("processWithLightningCSS cannot return source maps");
  }
  if (hasTailwindV4Import(css)) {
    throw new TypeError("Compile Tailwind imports before processing CSS with Lightning CSS");
  }
  if (css.length === 0) return "";

  const lightningCSS = await import("npm:lightningcss@1.29.2");
  const result = lightningCSS.transform({
    filename: options.filename,
    code: new TextEncoder().encode(css),
    minify: options.minify ?? true,
    sourceMap: false,
    targets: parseBrowserTargets(options.browserslist),
    analyzeDependencies: false,
    errorRecovery: false,
  });

  return new TextDecoder().decode(result.code);
}
