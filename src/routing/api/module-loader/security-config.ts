import { DEFAULT_ALLOWED_CDN_HOSTS, serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  MAX_REMOTE_HOST_COUNT,
  MAX_REMOTE_HOST_URL_LENGTH,
} from "#veryfront/utils/remote-host-policy-limits.ts";

const NativeArray = Array;
const NativeTypeError = TypeError;
const arrayIsArray = Array.isArray;
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const NativeURL = URL;
const numberIsSafeInteger = Number.isSafeInteger;
const numberToString = Number.prototype.toString;

function malformedResolvedConfig(): TypeError {
  return new NativeTypeError("Resolved API security configuration is unavailable or malformed");
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) return false;
  const prototype = getPrototypeOf(value);
  return prototype === null || prototype === objectPrototype;
}

function copyRemoteHosts(value: unknown): string[] {
  try {
    if (!arrayIsArray(value)) throw malformedResolvedConfig();

    const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !numberIsSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_REMOTE_HOST_COUNT
    ) {
      throw malformedResolvedConfig();
    }

    const hosts = new NativeArray<string>(lengthDescriptor.value);
    for (let index = 0; index < lengthDescriptor.value; index++) {
      const property = apply(numberToString, index, []) as string;
      const descriptor = getOwnPropertyDescriptor(value, property);
      if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
        throw malformedResolvedConfig();
      }
      if (descriptor.value.length > MAX_REMOTE_HOST_URL_LENGTH) {
        throw malformedResolvedConfig();
      }

      // getConfig() validates URL syntax. Repeat that narrow invariant here
      // because prepareHandlerModule() is also an exported boundary and must
      // fail closed when called without the validated config loader.
      new NativeURL(descriptor.value);
      hosts[index] = descriptor.value;
    }
    return hosts;
  } catch {
    throw malformedResolvedConfig();
  }
}

const defaultRemoteHosts = copyRemoteHosts(DEFAULT_ALLOWED_CDN_HOSTS);

/**
 * Resolve the remote-import policy from one already validated config snapshot.
 *
 * A missing snapshot means the policy is unavailable, so no remote host is
 * admitted. An existing snapshot with no explicit remoteHosts setting retains
 * the documented framework defaults. Explicit [] therefore means deny all.
 */
export function resolvePreparedRemoteHosts(
  config: VeryfrontConfig | undefined,
): string[] {
  if (config === undefined) return [];

  try {
    if (!isPlainRecord(config)) throw malformedResolvedConfig();

    const securityDescriptor = getOwnPropertyDescriptor(config, "security");
    if (!securityDescriptor) return copyRemoteHosts(defaultRemoteHosts);
    if (!("value" in securityDescriptor)) throw malformedResolvedConfig();

    const security = securityDescriptor.value;
    if (security === undefined) return copyRemoteHosts(defaultRemoteHosts);
    if (!isPlainRecord(security)) throw malformedResolvedConfig();

    const remoteHostsDescriptor = getOwnPropertyDescriptor(security, "remoteHosts");
    if (!remoteHostsDescriptor) {
      return copyRemoteHosts(defaultRemoteHosts);
    }
    if (!("value" in remoteHostsDescriptor)) throw malformedResolvedConfig();
    if (remoteHostsDescriptor.value === undefined) {
      return copyRemoteHosts(defaultRemoteHosts);
    }

    return copyRemoteHosts(remoteHostsDescriptor.value);
  } catch {
    throw malformedResolvedConfig();
  }
}

export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const { getConfig } = await import("#veryfront/config");
  const cfg: VeryfrontConfig = await getConfig(projectDir, adapter);
  const remoteHosts = resolvePreparedRemoteHosts(cfg);
  if (remoteHosts.length === 0) {
    logger.warn(
      "security.remoteHosts is set to an empty array — all remote requests will be blocked. " +
        "If this is intentional, you can ignore this warning.",
    );
  }
  return remoteHosts;
}
