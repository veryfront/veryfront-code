import { forEachPrivateArray, mapPrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { encodePrivateText, PrivateTextEncoder } from "#veryfront/security/private-text.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
const keys = Object.keys, descriptors = Object.getOwnPropertyDescriptors;
const prototype = Object.getPrototypeOf,
  plainPrototype = Object.prototype,
  symbols = Object.getOwnPropertySymbols;
const isArray = Array.isArray,
  finite = Number.isFinite,
  freeze = Object.freeze,
  values = Object.values,
  create = Object.create;
const ArraySome = Array.prototype.some;
const NativeError = Error;
const apply = Reflect.apply,
  sort = Array.prototype.sort,
  join = Array.prototype.join;
const trustedInputs = new WeakSet<object>();
const weakHas = WeakSet.prototype.has, weakAdd = WeakSet.prototype.add;
const encoder = new PrivateTextEncoder();
const sortedKeys = <TValue extends object>(value: TValue) =>
  apply(sort, keys(value), []) as string[];
/** JSON values transported separately from model-visible handoff instructions. */
export type HostedTaskInputValue =
  | null
  | boolean
  | number
  | string
  | readonly HostedTaskInputValue[]
  | {
    readonly [key: string]: HostedTaskInputValue;
  };

/** Immutable task input supplied by the host after durable admission. */
export type HostedTaskInput = {
  readonly version: 1;
  readonly projectId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly payload: Readonly<Record<string, HostedTaskInputValue>>;
};

/** Independently resolved execution authority, never taken from the input payload. */
export type HostedTaskInputScope = {
  projectId?: string | null;
  rootRunId?: string;
  runId?: string;
};

const invalid = () => new NativeError("Invalid host-owned task input");

function assertJson(value: unknown, depth = 0, budget = { remaining: 16_384 }): void {
  if (depth > 32 || --budget.remaining < 0) throw invalid();
  if (typeof value === "string" && value.length > 16_384) throw invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && finite(value)) return;
  if (typeof value !== "object") throw invalid();
  if (
    !isArray(value) && prototype(value) !== plainPrototype &&
    prototype(value) !== null
  ) throw invalid();
  if (
    isArray(value) &&
    (value.length > 16_384 || keys(value).length !== value.length ||
      apply(ArraySome, keys(value), [(key: string, index: number) => key !== `${index}`]))
  ) throw invalid();
  const properties = descriptors(value);
  forEachPrivateArray(keys(properties), (key) => {
    if (isArray(value) && key === "length") return;
    const descriptor = properties[key]!;
    if (descriptor.get || descriptor.set || !descriptor.enumerable) throw invalid();
    assertJson(descriptor.value, depth + 1, budget);
  });
  if (symbols(value).length) throw invalid();
}

function freezeJson(value: unknown): void {
  if (value && typeof value === "object") {
    forEachPrivateArray(values(value), freezeJson);
    freeze(value);
  }
}

/** Validate, snapshot and freeze the explicit host channel against execution authority. */
export function resolveHostedTaskInput(
  value: unknown,
  scope: HostedTaskInputScope,
): HostedTaskInput | undefined {
  if (value === undefined) return undefined;
  assertJson(value);
  if (!value || isArray(value) || typeof value !== "object") throw invalid();
  const input = value as Record<string, unknown>;
  const inputKeys = sortedKeys(input);
  if (
    apply(join, inputKeys, [","]) !== "payload,projectId,rootRunId,runId,version" ||
    input.version !== 1
  ) {
    throw invalid();
  }
  forEachPrivateArray(["projectId", "rootRunId", "runId"] as const, (key) => {
    if (typeof scope[key] !== "string" || !scope[key] || input[key] !== scope[key]) throw invalid();
  });
  if (!input.payload || typeof input.payload !== "object" || isArray(input.payload)) {
    throw invalid();
  }
  const encoded = privateJsonStringify(input);
  if (privateByteLength(encodePrivateText(encoded, encoder)) > 16_384) throw invalid();
  const snapshot = privateJsonParse(encoded) as HostedTaskInput;
  freezeJson(snapshot);
  if (apply(weakHas, trustedInputs, [value])) {
    apply(weakAdd, trustedInputs, [snapshot]);
  }
  return snapshot;
}

/** Deterministic digest encoding: recursively sort object keys; arrays retain order. */
export function encodeHostedTaskInput(input: HostedTaskInput): string {
  function canonical(value: HostedTaskInputValue): HostedTaskInputValue {
    if (!value || typeof value !== "object") return value;
    if (isArray(value)) return mapPrivateArray(value, canonical);
    const result: Record<string, HostedTaskInputValue> = create(null);
    forEachPrivateArray(sortedKeys(value), (key) => {
      result[key] = canonical((value as Record<string, HostedTaskInputValue>)[key]!);
    });
    return result;
  }
  return privateJsonStringify(canonical(input));
}

/** Validate shape without accepting its self-asserted scope as authority. */
export function snapshotHostedTaskInput(value: unknown): HostedTaskInput {
  assertJson(value);
  const record = value as HostedTaskInput;
  const result = resolveHostedTaskInput(value, {
    projectId: record?.projectId,
    rootRunId: record?.rootRunId,
    runId: record?.runId,
  });
  if (!result) throw invalid();
  return result;
}

/** @internal Only verified ingress or authenticated native admission may authorize this value. */
export function authorizeHostedTaskInput(value: HostedTaskInput): HostedTaskInput {
  apply(weakAdd, trustedInputs, [value]);
  return value;
}
/** Read the verified native channel. JSON reconstruction or a forged caller context cannot grant authority. */
export function getVerifiedHostedTaskInput(context: unknown): HostedTaskInput | undefined {
  if (!context || typeof context !== "object") return undefined;
  const properties = descriptors(context), input = properties.taskInput;
  if (!input) return undefined;
  if (input.get || input.set) throw invalid();
  if (input.value === undefined) return undefined;
  if (
    !input.value || typeof input.value !== "object" || !apply(weakHas, trustedInputs, [input.value])
  ) throw invalid();
  const scope: HostedTaskInputScope = create(null);
  forEachPrivateArray(["projectId", "rootRunId", "runId"] as const, (key) => {
    const property = properties[key];
    if (!property || property.get || property.set || typeof property.value !== "string") {
      throw invalid();
    }
    scope[key] = property.value;
  });
  return resolveHostedTaskInput(input.value, scope);
}

const executionInputs = createPrivateWeakStore<object, HostedTaskInput | undefined>();
type HostedTaskInputExecutionOwner = Parameters<typeof executionInputs.get>[0];

/** @internal Attach only verified, exact-scope input to a host-owned execution carrier. */
export function bindHostedTaskInputAuthority(
  owner: HostedTaskInputExecutionOwner,
  input: HostedTaskInput | undefined,
  scope: HostedTaskInputScope,
): void {
  executionInputs.set(owner, undefined);
  if (input === undefined) return;
  executionInputs.set(
    owner,
    getVerifiedHostedTaskInput({
      projectId: scope.projectId,
      runId: scope.runId,
      rootRunId: scope.rootRunId,
      taskInput: input,
    }),
  );
}

/** @internal Preserve input authority across framework-owned fork projections. */
export function inheritHostedTaskInputAuthority(
  target: HostedTaskInputExecutionOwner,
  source: HostedTaskInputExecutionOwner,
): void {
  executionInputs.set(target, executionInputs.get(source));
}

/** @internal Read the private channel against the actual execution project. */
export function readHostedTaskInputAuthority(
  owner: HostedTaskInputExecutionOwner,
  projectId: string | null,
): HostedTaskInput | undefined {
  const input = executionInputs.get(owner);
  if (input !== undefined && input.projectId !== projectId) throw invalid();
  return input;
}
