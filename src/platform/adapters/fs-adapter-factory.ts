import type { FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export async function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type || "local";

  if (type === "veryfront-api") {
    const { VeryfrontFSAdapter } = await import("./veryfront-fs-adapter.ts");

    const adapter = new VeryfrontFSAdapter(config);
    await adapter.initialize?.();
    return adapter;
  }

  throw toError(createError({
    type: "config",
    message: `FSAdapter type "${type}" is not implemented`,
  }));
}
