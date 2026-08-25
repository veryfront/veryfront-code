import type { ApplicationIdentity, AuthClaimValue, SerializedAuthClaims } from "./types.ts";

const MAX_CLAIMS_JSON_BYTES = 64 * 1024;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ENTRIES = 256;
const MAX_CONTAINER_DEPTH = 5;
const MAX_TOTAL_VALUES = 2_048;
const MAX_CLAIM_STRING_LENGTH = 4_096;
const MAX_ISSUER_LENGTH = 2_048;
const MAX_SUBJECT_LENGTH = 1_024;
const MAX_PROFILE_CLAIM_LENGTH = 512;
const MAX_GROUP_OR_ROLE_LENGTH = 256;

export interface ApplicationIdentityClaimNames {
  readonly email?: string;
  readonly name?: string;
  readonly groups?: string;
  readonly roles?: string;
}

export interface CreateApplicationIdentityOptions {
  readonly issuer: unknown;
  readonly expectedIssuer: string;
  readonly subject: unknown;
  readonly claims: unknown;
  readonly claimNames?: ApplicationIdentityClaimNames;
}

type UnknownRecord = { readonly [key: string]: unknown };
type MutableAuthClaimArray = AuthClaimValue[];
type MutableAuthClaimRecord = { [key: string]: AuthClaimValue };

interface ParseState {
  readonly seen: WeakSet<object>;
  totalValues: number;
}

export function createApplicationIdentity(
  options: CreateApplicationIdentityOptions,
): ApplicationIdentity {
  const issuer = parseIssuer(options.issuer, options.expectedIssuer);
  const subject = parseSubject(options.subject);
  const claims = parseClaimSnapshot(options.claims);
  const claimNames = options.claimNames ?? {};
  const groupsComplete = !hasMicrosoftGroupOverage(claims);
  const identity: ApplicationIdentity = {
    issuer,
    subject,
    ...parseOptionalProfileClaims(claims, claimNames),
    groups: freezeArray(parseStringListClaim(claims, claimNames.groups, "groups")),
    roles: freezeArray(parseStringListClaim(claims, claimNames.roles, "roles")),
    groupsComplete,
    claims,
  };

  return Object.freeze(identity);
}

function parseIssuer(value: unknown, expectedIssuer: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ISSUER_LENGTH) {
    throw new TypeError("Application identity issuer must be a bounded non-empty string");
  }
  if (value !== expectedIssuer) {
    throw new TypeError("Application identity issuer must exactly match the configured issuer");
  }
  return value;
}

function parseSubject(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SUBJECT_LENGTH) {
    throw new TypeError("Application identity subject must be a bounded non-empty string");
  }
  return value;
}

function parseClaimSnapshot(value: unknown): SerializedAuthClaims {
  const state: ParseState = {
    seen: new WeakSet<object>(),
    totalValues: 0,
  };
  const snapshot = parseClaimObject(value, state, 0, "claims");
  const json = JSON.stringify(snapshot);
  if (new TextEncoder().encode(json).byteLength > MAX_CLAIMS_JSON_BYTES) {
    throw new TypeError("Application identity claims exceed the serialized size limit");
  }
  return deepFreeze(snapshot);
}

function parseClaimObject(
  value: unknown,
  state: ParseState,
  depth: number,
  path: string,
): MutableAuthClaimRecord {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object`);
  }
  if (state.seen.has(value)) {
    throw new TypeError(`${path} contains a cycle`);
  }
  if (depth >= MAX_CONTAINER_DEPTH) {
    throw new TypeError(`${path} exceeds the nested container depth limit`);
  }
  state.seen.add(value);
  countValue(state, path);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    throw new TypeError(`${path} contains a non-JSON-safe symbol key`);
  }

  const keys = Object.keys(descriptors);
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new TypeError(`${path} exceeds the object key limit`);
  }

  const output: MutableAuthClaimRecord = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${path}.${key} contains an accessor property`);
    }
    output[key] = parseClaimValue(descriptor.value, state, depth + 1, `${path}.${key}`);
  }
  state.seen.delete(value);
  return output;
}

function parseClaimArray(
  value: readonly unknown[],
  state: ParseState,
  depth: number,
  path: string,
): MutableAuthClaimArray {
  if (state.seen.has(value)) {
    throw new TypeError(`${path} contains a cycle`);
  }
  if (depth >= MAX_CONTAINER_DEPTH) {
    throw new TypeError(`${path} exceeds the nested container depth limit`);
  }
  if (value.length > MAX_ARRAY_ENTRIES) {
    throw new TypeError(`${path} exceeds the array entry limit`);
  }
  state.seen.add(value);
  countValue(state, path);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    throw new TypeError(`${path} contains a non-JSON-safe symbol key`);
  }

  const output: MutableAuthClaimArray = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor) {
      throw new TypeError(`${path} contains a sparse array entry`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`${path}.${index} contains an accessor property`);
    }
    output.push(parseClaimValue(descriptor.value, state, depth + 1, `${path}.${index}`));
  }
  for (const key of Object.keys(descriptors)) {
    if (/^(?:0|[1-9][0-9]*)$/.test(key) || key === "length") continue;
    throw new TypeError(`${path} contains a non-JSON-safe array property`);
  }
  state.seen.delete(value);
  return output;
}

function parseClaimValue(
  value: unknown,
  state: ParseState,
  depth: number,
  path: string,
): AuthClaimValue {
  if (value === null || typeof value === "boolean") {
    countValue(state, path);
    return value;
  }

  if (typeof value === "string") {
    countValue(state, path);
    if (value.length > MAX_CLAIM_STRING_LENGTH) {
      throw new TypeError(`${path} contains a string over the claim string limit`);
    }
    return value;
  }

  if (typeof value === "number") {
    countValue(state, path);
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-JSON-safe number`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return parseClaimArray(value, state, depth, path);
  }

  if (isPlainObject(value)) {
    return parseClaimObject(value, state, depth, path);
  }

  throw new TypeError(`${path} contains an unsupported claim value`);
}

function countValue(state: ParseState, path: string): void {
  state.totalValues += 1;
  if (state.totalValues > MAX_TOTAL_VALUES) {
    throw new TypeError(`${path} exceeds the total claim value limit`);
  }
}

function parseOptionalProfileClaims(
  claims: SerializedAuthClaims,
  claimNames: ApplicationIdentityClaimNames,
): Pick<ApplicationIdentity, "email" | "name"> {
  const output: { email?: string; name?: string } = {};
  if (claimNames.email !== undefined) {
    output.email = parseOptionalStringClaim(
      claims,
      claimNames.email,
      "email",
      MAX_PROFILE_CLAIM_LENGTH,
    );
  }
  if (claimNames.name !== undefined) {
    output.name = parseOptionalStringClaim(
      claims,
      claimNames.name,
      "name",
      MAX_PROFILE_CLAIM_LENGTH,
    );
  }
  return output;
}

function parseOptionalStringClaim(
  claims: SerializedAuthClaims,
  claimName: string,
  fieldName: string,
  maxLength: number,
): string | undefined {
  const value = claims[claimName];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`Application identity ${fieldName} claim must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > maxLength) {
    throw new TypeError(`Application identity ${fieldName} claim exceeds the length limit`);
  }
  return normalized;
}

function parseStringListClaim(
  claims: SerializedAuthClaims,
  claimName: string | undefined,
  fieldName: "groups" | "roles",
): readonly string[] {
  if (claimName === undefined) return [];
  const value = claims[claimName];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`Application identity ${fieldName} claim must be an array of strings`);
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new TypeError(`Application identity ${fieldName} claim must contain only strings`);
    }
    const normalized = entry.trim();
    if (normalized.length === 0) continue;
    if (normalized.length > MAX_GROUP_OR_ROLE_LENGTH) {
      throw new TypeError(`Application identity ${fieldName} claim entry exceeds the length limit`);
    }
    if (seen.has(normalized)) continue;
    if (output.length >= MAX_ARRAY_ENTRIES) {
      throw new TypeError(`Application identity ${fieldName} claim exceeds the entry limit`);
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function hasMicrosoftGroupOverage(claims: SerializedAuthClaims): boolean {
  if (claims.hasgroups === true) return true;

  const claimNames = claims._claim_names;
  const claimSources = claims._claim_sources;
  if (!isClaimRecord(claimNames) || !isClaimRecord(claimSources)) return false;

  const groupSource = claimNames.groups;
  if (typeof groupSource !== "string" || groupSource.length === 0) return false;

  return isClaimRecord(claimSources[groupSource]);
}

function isClaimRecord(value: AuthClaimValue | undefined): value is SerializedAuthClaims {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T extends AuthClaimValue>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
    return value;
  }
  if (isClaimRecord(value)) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
  }
  return value;
}

function freezeArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}
