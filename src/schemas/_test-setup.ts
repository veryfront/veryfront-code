/**
 * Test-only helper: registers the zod-backed SchemaValidator so unit tests
 * that exercise `defineSchema` work without going through full app
 * bootstrap (which is where ext-schema-zod normally registers itself).
 *
 * Import this file as a side effect at the top of any `*.test.ts` whose
 * runtime path resolves a SchemaValidator-backed schema.
 *
 * @module schemas/_test-setup
 */

import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

if (!tryResolve<SchemaValidator>("SchemaValidator")) {
  register<SchemaValidator>("SchemaValidator", createZodAdapter());
}
