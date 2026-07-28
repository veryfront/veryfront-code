import { transform } from "npm:lightningcss@1.29.2";
import { assertBalancedCssSyntax } from "../css-syntax.ts";

/** Minify CSS with the registered parser-backed bundler. */
export async function minifyCSS(css: string): Promise<string> {
  if (typeof css !== "string") {
    throw new TypeError("CSS content must be a string");
  }
  assertBalancedCssSyntax(css, "Tailwind CSS");

  const result = transform({
    filename: "tailwind.css",
    code: new TextEncoder().encode(css),
    minify: true,
  });
  return new TextDecoder().decode(result.code).trim();
}
