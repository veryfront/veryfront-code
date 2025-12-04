import type { FSAdapter, FSAdapterConfig } from "./veryfront-fs-adapter/types.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export async function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type || "local";

  // Local filesystem uses the native runtime adapter directly.
  // This factory should not be called for "local" type - the caller
  // should use RuntimeAdapter.fs directly instead (see fs-integration.ts).
  if (type === "local") {
    throw toError(
      createError({
        type: "config",
        message: `FSAdapter type "local" should not use this factory. ` +
          `Use RuntimeAdapter.fs directly for local filesystem access. ` +
          `If you're seeing this error, check your veryfront.config.ts fs configuration.`,
      }),
    );
  }

  if (type === "veryfront-api") {
    const { VeryfrontFSAdapter } = await import("./veryfront-fs-adapter.ts");

    const adapter = new VeryfrontFSAdapter(config);
    await adapter.initialize?.();
    return adapter;
  }

  throw toError(
    createError({
      type: "config",
      message: `FSAdapter type "${type}" is not implemented. ` +
        `Supported types: "local" (default, uses RuntimeAdapter.fs), "veryfront-api".`,
    }),
  );
}
