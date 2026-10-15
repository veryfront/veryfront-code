import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";

// Identity may first be requested after tenant code has run in this process.
const apply = Reflect.apply;
const StringTrim = String.prototype.trim;
const StringSlice = String.prototype.slice;
const RegExpExec = RegExp.prototype.exec;
const EncodeURIComponent = encodeURIComponent;
const ObjectFreeze = Object.freeze;
const NativeError = Error;
const CONTROL_CHARACTERS = /\p{Cc}/u;

export const RUNTIME_ID_HEADER = "x-veryfront-runtime-id";
export const RUNTIME_NAME_HEADER = "x-veryfront-runtime-name";
export const RUNTIME_MODE_HEADER = "x-veryfront-runtime-mode";

/** Identity of the service process, independent of its load-balanced endpoint. */
export type ServiceRuntimeIdentity = Readonly<{
  id: string;
  name: string;
  mode: "service";
}>;

/** Validate before accepting work so invalid display names cannot break a response. */
export function resolveServiceRuntimeName(
  configured: string | undefined,
  readHostname: () => string = hostname,
): string {
  const explicit = configured === undefined ? undefined : apply(StringTrim, configured, []);
  if (explicit) {
    if (explicit.length > 128 || apply(RegExpExec, CONTROL_CHARACTERS, [explicit]) !== null) {
      throw new NativeError(
        "VERYFRONT_RUNTIME_NAME must contain at most 128 UTF-16 code units without control characters.",
      );
    }
    try {
      EncodeURIComponent(explicit);
    } catch {
      throw new NativeError("VERYFRONT_RUNTIME_NAME must contain valid Unicode.");
    }
    return explicit;
  }
  try {
    const name = apply(StringSlice, apply(StringTrim, readHostname(), []), [0, 128]);
    if (name && apply(RegExpExec, CONTROL_CHARACTERS, [name]) === null) {
      EncodeURIComponent(name);
      return name;
    }
  } catch {
    // Hostname lookup is optional; process identity must still be available.
  }
  return "Service runtime";
}

let processIdentity: ServiceRuntimeIdentity | undefined;

/** Capture the trusted service environment once, before importing project code. */
export function initializeServiceRuntimeIdentity(
  environment?: Record<string, string | undefined>,
): ServiceRuntimeIdentity {
  return processIdentity ??= ObjectFreeze({
    id: randomUUID(),
    name: resolveServiceRuntimeName(
      environment === undefined
        ? getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME")
        : environment.VERYFRONT_RUNTIME_NAME,
    ),
    mode: "service",
  });
}

/** All route sets in this process share one ID; a new process generates a new ID. */
export function getServiceRuntimeIdentity(): ServiceRuntimeIdentity {
  return initializeServiceRuntimeIdentity();
}
