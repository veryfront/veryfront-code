import denoConfig from "../../../deno.json" with { type: "json" };
import { getEnv } from "../../platform/compat/process.ts";

export const VERSION: string = getEnv("VERYFRONT_VERSION") ||
  (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");
