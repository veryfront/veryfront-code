import type { ApplicationIdentity, AuthClaimValue, SerializedAuthClaims } from "./types.ts";
import { types as nodeUtilTypes } from "node:util";

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
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const NativeJSON = JSON;
const NativeNumber = Number;
const NativeObject = Object;
const NativeSet = Set;
const NativeTextEncoder = TextEncoder;
const NativeWeakSet = WeakSet;
const jsonStringify = NativeJSON.stringify;
const numberIsFinite = NativeNumber.isFinite;
const objectCreate = NativeObject.create;
const objectDefineProperty = NativeObject.defineProperty;
const objectFreeze = NativeObject.freeze;
const objectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const objectGetOwnPropertyDescriptors = NativeObject.getOwnPropertyDescriptors;
const objectGetOwnPropertySymbols = NativeObject.getOwnPropertySymbols;
const objectGetPrototypeOf = NativeObject.getPrototypeOf;
const objectKeys = NativeObject.keys;
const objectPrototype = NativeObject.prototype;
const objectValues = NativeObject.values;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const setAdd = NativeSet.prototype.add;
const setHas = NativeSet.prototype.has;
const stringTrim = String.prototype.trim;
const textEncoderEncode = NativeTextEncoder.prototype.encode;
const weakSetAdd = NativeWeakSet.prototype.add;
const weakSetDelete = NativeWeakSet.prototype.delete;
const weakSetHas = NativeWeakSet.prototype.has;
const isProxy = nodeUtilTypes.isProxy;

const IDENTITY_REQUIRED_KEYS = apply(objectFreeze, NativeObject, [[
  "issuer",
  "subject",
  "groups",
  "roles",
  "groupsComplete",
  "claims",
]]) as readonly string[];

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

function arrayAppend<T>(array: T[], value: T): void {
  apply(arrayPush, array, [value]);
}

function freeze<T>(value: T): Readonly<T> {
  return apply(objectFreeze, NativeObject, [value]) as Readonly<T>;
}

function setContains<T>(set: ReadonlySet<T>, value: T): boolean {
  return apply(setHas, set, [value]) as boolean;
}

function setInsert<T>(set: Set<T>, value: T): void {
  apply(setAdd, set, [value]);
}

function weakSetContains(set: WeakSet<object>, value: object): boolean {
  return apply(weakSetHas, set, [value]) as boolean;
}

function weakSetInsert(set: WeakSet<object>, value: object): void {
  apply(weakSetAdd, set, [value]);
}

function weakSetRemove(set: WeakSet<object>, value: object): void {
  apply(weakSetDelete, set, [value]);
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

  return freeze(identity) as ApplicationIdentity;
}

export function snapshotApplicationIdentity(value: unknown): ApplicationIdentity {
  const root = parseIdentityRoot(value);
  const claims = parseClaimSnapshot(readRequiredIdentityField(root, "claims"));
  const profile = parseOptionalIdentityProfile(root);
  const identity = apply(objectCreate, NativeObject, [null]) as ApplicationIdentity;
  defineIdentitySnapshotField(
    identity,
    "issuer",
    parseIdentityIssuer(readRequiredIdentityField(root, "issuer")),
  );
  defineIdentitySnapshotField(
    identity,
    "subject",
    parseSubject(readRequiredIdentityField(root, "subject")),
  );
  if (profile.email !== undefined) {
    defineIdentitySnapshotField(identity, "email", profile.email);
  }
  if (profile.name !== undefined) {
    defineIdentitySnapshotField(identity, "name", profile.name);
  }
  defineIdentitySnapshotField(
    identity,
    "groups",
    freezeArray(parseSerializedStringList(readRequiredIdentityField(root, "groups"), "groups")),
  );
  defineIdentitySnapshotField(
    identity,
    "roles",
    freezeArray(parseSerializedStringList(readRequiredIdentityField(root, "roles"), "roles")),
  );
  defineIdentitySnapshotField(
    identity,
    "groupsComplete",
    parseGroupsComplete(readRequiredIdentityField(root, "groupsComplete")),
  );
  defineIdentitySnapshotField(identity, "claims", claims);

  return freeze(identity) as ApplicationIdentity;
}

function parseIdentityRoot(value: unknown): UnknownRecord {
  if (!isPlainObject(value)) {
    throw new TypeError("Application identity must be a plain object");
  }

  const ownKeys = apply(reflectOwnKeys, Reflect, [value]) as PropertyKey[];
  const keys: string[] = [];
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index]!;
    if (typeof key !== "string") {
      throw new TypeError("Application identity contains a non-JSON-safe symbol key");
    }
    const descriptor = apply(objectGetOwnPropertyDescriptor, NativeObject, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (!descriptor) {
      throw new TypeError(`Application identity is missing ${key}`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(`Application identity ${key} contains an accessor property`);
    }
    if (!descriptor.enumerable) {
      throw new TypeError(`Application identity contains an unsupported ${key} field`);
    }
    if (!isIdentityRootField(key)) {
      throw new TypeError(`Application identity contains an unsupported ${key} field`);
    }
    arrayAppend(keys, key);
  }
  for (let index = 0; index < IDENTITY_REQUIRED_KEYS.length; index += 1) {
    const key = IDENTITY_REQUIRED_KEYS[index]!;
    if (
      apply(objectGetOwnPropertyDescriptor, NativeObject, [
        value,
        key,
      ]) === undefined
    ) {
      throw new TypeError(`Application identity is missing ${key}`);
    }
  }

  const descriptors = apply(objectGetOwnPropertyDescriptors, NativeObject, [
    value,
  ]) as unknown as PropertyDescriptorMap;
  const output = apply(objectCreate, NativeObject, [null]) as UnknownRecord;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = descriptors[key] ??
      (apply(objectGetOwnPropertyDescriptor, NativeObject, [
        value,
        key,
      ]) as PropertyDescriptor | undefined);
    if (descriptor) {
      apply(objectDefineProperty, NativeObject, [output, key, {
        value: descriptor,
        enumerable: true,
        configurable: true,
        writable: true,
      }]);
    }
  }
  return output;
}

function isIdentityRootField(key: string): boolean {
  switch (key) {
    case "issuer":
    case "subject":
    case "email":
    case "name":
    case "groups":
    case "roles":
    case "groupsComplete":
    case "claims":
      return true;
    default:
      return false;
  }
}

function defineIdentitySnapshotField<Key extends keyof ApplicationIdentity>(
  identity: ApplicationIdentity,
  key: Key,
  value: ApplicationIdentity[Key],
): void {
  apply(objectDefineProperty, NativeObject, [identity, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  }]);
}

function readRequiredIdentityField(root: UnknownRecord, key: string): unknown {
  const descriptor = root[key] as PropertyDescriptor | undefined;
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`Application identity is missing ${key}`);
  }
  return descriptor.value;
}

function parseIdentityIssuer(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ISSUER_LENGTH) {
    throw new TypeError("Application identity issuer must be a bounded non-empty string");
  }
  return value;
}

function parseOptionalIdentityProfile(
  root: UnknownRecord,
): Pick<ApplicationIdentity, "email" | "name"> {
  const output: { email?: string; name?: string } = {};
  const email = root.email as PropertyDescriptor | undefined;
  if (email !== undefined) {
    if (!("value" in email)) {
      throw new TypeError("Application identity email contains an accessor property");
    }
    output.email = parseOptionalIdentityString(email.value, "email", MAX_PROFILE_CLAIM_LENGTH);
  }
  const name = root.name as PropertyDescriptor | undefined;
  if (name !== undefined) {
    if (!("value" in name)) {
      throw new TypeError("Application identity name contains an accessor property");
    }
    output.name = parseOptionalIdentityString(name.value, "name", MAX_PROFILE_CLAIM_LENGTH);
  }
  return output;
}

function parseOptionalIdentityString(
  value: unknown,
  fieldName: "email" | "name",
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") {
    throw new TypeError(`Application identity ${fieldName} must be a string`);
  }
  const normalized = apply(stringTrim, value, []) as string;
  if (normalized.length === 0) return undefined;
  if (normalized.length > maxLength) {
    throw new TypeError(`Application identity ${fieldName} exceeds the length limit`);
  }
  return normalized;
}

function parseGroupsComplete(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("Application identity groupsComplete must be a boolean");
  }
  return value;
}

function parseSerializedStringList(
  value: unknown,
  fieldName: "groups" | "roles",
): readonly string[] {
  if (!arrayIsArray(value) || isProxy(value)) {
    throw new TypeError(`Application identity ${fieldName} must be an array of strings`);
  }
  if (value.length > MAX_ARRAY_ENTRIES) {
    throw new TypeError(`Application identity ${fieldName} exceeds the entry limit`);
  }
  const descriptors = apply(objectGetOwnPropertyDescriptors, NativeObject, [
    value,
  ]) as unknown as PropertyDescriptorMap;
  const symbolKeys = apply(objectGetOwnPropertySymbols, NativeObject, [value]) as symbol[];
  if (symbolKeys.length > 0) {
    throw new TypeError(`Application identity ${fieldName} contains a non-JSON-safe symbol key`);
  }

  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor) {
      throw new TypeError(`Application identity ${fieldName} contains a sparse array entry`);
    }
    if (!("value" in descriptor)) {
      throw new TypeError(
        `Application identity ${fieldName}.${index} contains an accessor property`,
      );
    }
    if (typeof descriptor.value !== "string") {
      throw new TypeError(`Application identity ${fieldName} must contain only strings`);
    }
    const normalized = apply(stringTrim, descriptor.value, []) as string;
    if (normalized.length === 0) continue;
    if (normalized.length > MAX_GROUP_OR_ROLE_LENGTH) {
      throw new TypeError(`Application identity ${fieldName} entry exceeds the length limit`);
    }
    arrayAppend(output, normalized);
  }
  const keys = apply(objectKeys, NativeObject, [descriptors]) as string[];
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    if ((apply(regexpTest, ARRAY_INDEX_PATTERN, [key]) as boolean) || key === "length") continue;
    throw new TypeError(
      `Application identity ${fieldName} contains a non-JSON-safe array property`,
    );
  }
  return output;
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
    seen: new NativeWeakSet<object>(),
    totalValues: 0,
  };
  const snapshot = parseClaimObject(value, state, 0, "claims");
  const json = apply(jsonStringify, NativeJSON, [snapshot]) as string;
  const encoder = new NativeTextEncoder();
  const bytes = apply(textEncoderEncode, encoder, [json]) as Uint8Array;
  if (bytes.byteLength > MAX_CLAIMS_JSON_BYTES) {
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
  if (weakSetContains(state.seen, value)) {
    throw new TypeError(`${path} contains a cycle`);
  }
  if (depth >= MAX_CONTAINER_DEPTH) {
    throw new TypeError(`${path} exceeds the nested container depth limit`);
  }
  weakSetInsert(state.seen, value);
  countValue(state, path);

  const symbolKeys = apply(objectGetOwnPropertySymbols, NativeObject, [value]) as symbol[];
  if (symbolKeys.length > 0) {
    throw new TypeError(`${path} contains a non-JSON-safe symbol key`);
  }

  const keys = apply(objectKeys, NativeObject, [value]) as string[];
  if (keys.length > MAX_OBJECT_KEYS) {
    throw new TypeError(`${path} exceeds the object key limit`);
  }

  const output = apply(objectCreate, NativeObject, [null]) as MutableAuthClaimRecord;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    const descriptor = apply(objectGetOwnPropertyDescriptor, NativeObject, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${path}.${key} contains an accessor property`);
    }
    apply(objectDefineProperty, NativeObject, [output, key, {
      value: parseClaimValue(descriptor.value, state, depth + 1, `${path}.${key}`),
      enumerable: true,
      configurable: true,
      writable: true,
    }]);
  }
  weakSetRemove(state.seen, value);
  return output;
}

function parseClaimArray(
  value: readonly unknown[],
  state: ParseState,
  depth: number,
  path: string,
): MutableAuthClaimArray {
  if (isProxy(value)) {
    throw new TypeError(`${path} must be a plain array`);
  }
  if (weakSetContains(state.seen, value)) {
    throw new TypeError(`${path} contains a cycle`);
  }
  if (depth >= MAX_CONTAINER_DEPTH) {
    throw new TypeError(`${path} exceeds the nested container depth limit`);
  }
  if (value.length > MAX_ARRAY_ENTRIES) {
    throw new TypeError(`${path} exceeds the array entry limit`);
  }
  weakSetInsert(state.seen, value);
  countValue(state, path);

  const descriptors = apply(objectGetOwnPropertyDescriptors, NativeObject, [
    value,
  ]) as unknown as PropertyDescriptorMap;
  const symbolKeys = apply(objectGetOwnPropertySymbols, NativeObject, [value]) as symbol[];
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
    arrayAppend(output, parseClaimValue(descriptor.value, state, depth + 1, `${path}.${index}`));
  }
  const keys = apply(objectKeys, NativeObject, [descriptors]) as string[];
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    if ((apply(regexpTest, ARRAY_INDEX_PATTERN, [key]) as boolean) || key === "length") continue;
    throw new TypeError(`${path} contains a non-JSON-safe array property`);
  }
  weakSetRemove(state.seen, value);
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
    if (!numberIsFinite(value)) {
      throw new TypeError(`${path} contains a non-JSON-safe number`);
    }
    return value;
  }

  if (arrayIsArray(value)) {
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
  const normalized = apply(stringTrim, value, []) as string;
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
  if (!arrayIsArray(value)) {
    throw new TypeError(`Application identity ${fieldName} claim must be an array of strings`);
  }

  const seen = new NativeSet<string>();
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string") {
      throw new TypeError(`Application identity ${fieldName} claim must contain only strings`);
    }
    const normalized = apply(stringTrim, entry, []) as string;
    if (normalized.length === 0) continue;
    if (normalized.length > MAX_GROUP_OR_ROLE_LENGTH) {
      throw new TypeError(`Application identity ${fieldName} claim entry exceeds the length limit`);
    }
    if (setContains(seen, normalized)) continue;
    if (output.length >= MAX_ARRAY_ENTRIES) {
      throw new TypeError(`Application identity ${fieldName} claim exceeds the entry limit`);
    }
    setInsert(seen, normalized);
    arrayAppend(output, normalized);
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
  return typeof value === "object" && value !== null && !arrayIsArray(value);
}

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) return false;
  if (isProxy(value)) return false;
  const prototype = apply(objectGetPrototypeOf, NativeObject, [value]) as object | null;
  return prototype === objectPrototype || prototype === null;
}

function deepFreeze<T extends AuthClaimValue>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  freeze(value);
  if (arrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      deepFreeze(value[index]!);
    }
    return value;
  }
  if (isClaimRecord(value)) {
    const values = apply(objectValues, NativeObject, [value]) as AuthClaimValue[];
    for (let index = 0; index < values.length; index += 1) {
      deepFreeze(values[index]!);
    }
  }
  return value;
}

function freezeArray(values: readonly string[]): readonly string[] {
  const output: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    arrayAppend(output, values[index]!);
  }
  return freeze(output) as readonly string[];
}
