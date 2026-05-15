/**
 * ext-schema-zod — SchemaValidator implementation backed by zod.
 *
 * Provides the `SchemaValidator` contract via a zod-backed adapter. Core
 * modules declare schemas through `defineSchema((v) => …)` (in
 * `src/schemas/define.ts`); the lazy factory resolves this contract on first
 * use and the adapter routes calls into zod.
 *
 * Registered automatically by `createBuiltinExtensions()`. Tests that need
 * the adapter without going through full extension bootstrap can import
 * `createZodAdapter` directly from this module's `./adapter.ts`.
 *
 * @module extensions/ext-schema-zod
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { createZodAdapter } from "./adapter.ts";

const extZod: ExtensionFactory = () => {
  const impl = createZodAdapter();
  return {
    name: "ext-schema-zod",
    version: "0.1.0",
    contracts: {
      provides: ["SchemaValidator"],
    },
    capabilities: [],
    setup(ctx) {
      ctx.provide("SchemaValidator", impl);
      ctx.logger.info("[ext-schema-zod] SchemaValidator registered");
    },
    teardown() {
      // No resources to release.
    },
  };
};

export default extZod;
export { createZodAdapter } from "./adapter.ts";
