import type { ResolvedExtension } from "./types.ts";
import extOpenAI from "../../extensions/ext-openai/src/index.ts";
import extAnthropic from "../../extensions/ext-anthropic/src/index.ts";
import extGoogle from "../../extensions/ext-google/src/index.ts";

export const builtinProviderExtensions: ResolvedExtension[] = [
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
