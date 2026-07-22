import { register, tryResolve } from "./contracts.ts";
import type { SchemaValidator } from "./schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

/** Ensure the default schema validator is available to schema-backed framework APIs. */
export function ensureBuiltinSchemaValidator(): void {
  if (!tryResolve<SchemaValidator>("SchemaValidator")) {
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  }
}
