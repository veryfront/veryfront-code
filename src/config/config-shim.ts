import { defineConfig, defineConfigWithEnv, mergeConfigs } from "./define-config.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export type ConfigShimBridge = Readonly<{
  defineConfig: typeof defineConfig;
  defineConfigWithEnv: typeof defineConfigWithEnv;
  getEnv: typeof getEnv;
  mergeConfigs: typeof mergeConfigs;
}>;

export type ConfigShimModule = Readonly<{
  source: string;
  url: string;
}>;

export function createConfigShimModule(
  name: string,
  bridge: ConfigShimBridge,
): ConfigShimModule {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid config shim name "${name}"`);
  }

  const bridgeKey = `__veryfrontConfigShimBridgeV1:${name}:${crypto.randomUUID()}`;
  const frozenBridge = Object.freeze({ ...bridge });
  Object.defineProperty(globalThis, bridgeKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: frozenBridge,
  });

  const source = [
    `const bridge = globalThis[${JSON.stringify(bridgeKey)}];`,
    'if (!bridge) throw new Error("Veryfront config helper bridge is unavailable");',
    "export const defineConfig = bridge.defineConfig;",
    "export const defineConfigWithEnv = bridge.defineConfigWithEnv;",
    "export const getEnv = bridge.getEnv;",
    "export const mergeConfigs = bridge.mergeConfigs;",
  ].join("\n");

  return Object.freeze({
    source,
    url: `data:text/javascript,${encodeURIComponent(source)}`,
  });
}

const defaultConfigShim = createConfigShimModule("loader", {
  defineConfig,
  defineConfigWithEnv,
  getEnv,
  mergeConfigs,
});

/** Source for the bare `veryfront` module used while evaluating project config. */
export const VERYFRONT_CONFIG_SHIM_SOURCE = defaultConfigShim.source;

/** Data URL form used by temp-file config imports. */
export const VERYFRONT_CONFIG_SHIM_URL = defaultConfigShim.url;
