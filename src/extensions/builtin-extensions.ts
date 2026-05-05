import type { ResolvedExtension } from "./types.ts";
import extOpenAI from "../../extensions/ext-openai/src/index.ts";
import extAnthropic from "../../extensions/ext-anthropic/src/index.ts";
import extGoogle from "../../extensions/ext-google/src/index.ts";
import extEsbuild from "../../extensions/ext-esbuild/src/index.ts";
import extBabel from "../../extensions/ext-babel/src/index.ts";
import extMdx from "../../extensions/ext-mdx/src/index.ts";
import extTailwind from "../../extensions/ext-tailwind/src/index.ts";
import extNodeCompat from "../../extensions/ext-node-compat/src/index.ts";

export function createBuiltinExtensions(): ResolvedExtension[] {
  return [
    {
      source: "builtin",
      origin: "veryfront/ext-esbuild",
      extension: extEsbuild(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-babel",
      extension: extBabel(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-mdx",
      extension: extMdx(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-tailwind",
      extension: extTailwind(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-node-compat",
      extension: extNodeCompat(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-openai",
      extension: extOpenAI(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-anthropic",
      extension: extAnthropic(),
    },
    {
      source: "builtin",
      origin: "veryfront/ext-google",
      extension: extGoogle(),
    },
  ];
}
