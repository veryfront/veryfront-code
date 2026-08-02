/** PurgeCSS implementation of the provider-neutral CSSPurgingEngine contract. */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type CSSPurgingEngine,
  CSSPurgingEngineName,
  type CSSPurgingRequest,
  type CSSPurgingResult,
} from "veryfront/extensions/css";
import { PurgeCSS } from "purgecss";
import extensionPackage from "../deno.json" with { type: "json" };

const ENGINE_SEMANTICS_VERSION = "veryfront.css-purgecss.v1";

function dependencyVersion(specifier: string): string {
  const match = specifier.match(/@([^@/]+)$/);
  if (!match?.[1]) {
    throw new TypeError("ext-css-purgecss dependency version must be exact");
  }
  return match[1];
}

function assertEmptyConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("ext-css-purgecss config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-css-purgecss config could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ext-css-purgecss config must not inherit configuration");
  }
  if (keys.length !== 0) {
    throw new TypeError("ext-css-purgecss does not accept configuration properties");
  }
}

export class PurgeCSSPurgingEngine implements CSSPurgingEngine {
  readonly cacheIdentity: string;

  constructor() {
    this.cacheIdentity = [
      ENGINE_SEMANTICS_VERSION,
      `ext-css-purgecss@${extensionPackage.version}`,
      `purgecss@${dependencyVersion(extensionPackage.imports.purgecss)}`,
    ].join(";");
    Object.freeze(this);
  }

  async purge(request: CSSPurgingRequest): Promise<CSSPurgingResult> {
    const results = await new PurgeCSS().purge({
      content: request.content.map((source) => ({
        raw: source.raw,
        extension: source.extension,
      })),
      css: [{ raw: request.css }],
      safelist: [...request.safelist],
      rejectedCss: request.includeRejectedCSS,
    });
    const result = results[0];
    if (results.length !== 1 || result === undefined || typeof result.css !== "string") {
      throw new TypeError("PurgeCSS returned an invalid result");
    }
    const rejectedCSS = request.includeRejectedCSS ? result.rejectedCss : undefined;
    if (request.includeRejectedCSS && typeof rejectedCSS !== "string") {
      throw new TypeError("PurgeCSS omitted requested rejected CSS");
    }
    return {
      css: result.css,
      ...(typeof rejectedCSS === "string" ? { rejectedCSS } : {}),
    };
  }
}

const extCSSPurgeCSS: ExtensionFactory = (config) => {
  assertEmptyConfig(config);
  const engine = new PurgeCSSPurgingEngine();
  return {
    name: "ext-css-purgecss",
    version: extensionPackage.version,
    contracts: { provides: [CSSPurgingEngineName] },
    capabilities: [{ type: "system:read", apis: ["cpus"] }],
    setup(ctx) {
      ctx.provide(CSSPurgingEngineName, engine);
      ctx.logger.debug(`[ext-css-purgecss] ${CSSPurgingEngineName} registered`);
    },
  };
};

export default extCSSPurgeCSS;
