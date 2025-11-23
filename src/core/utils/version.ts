import denoConfig from "../../../deno.json" with { type: "json" };

export const VERSION: string = typeof denoConfig.version === "string"
  ? denoConfig.version
  : "0.0.0";
