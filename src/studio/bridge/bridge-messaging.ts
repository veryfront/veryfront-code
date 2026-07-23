/**
 * Bridge Messaging
 *
 * Communication layer between the preview iframe and Studio.
 * Captures the Studio origin from the first valid incoming message
 * and uses it as the targetOrigin for outgoing postMessage calls
 * to prevent information leakage to untrusted embedders.
 *
 * Outgoing messages use a bounded, priority-aware scheduler after the
 * handshake establishes studioOrigin. Messages sent before the handshake
 * join the same queue. This avoids broadcasting with targetOrigin "*" and
 * prevents high-volume producers from synchronously flooding the parent.
 */

import { resolveTrustedStudioOrigin } from "#veryfront/security/http/studio-origin-policy.ts";
import type { MessageFromRenderer } from "#veryfront/studio/schemas/studio.schema.ts";
import {
  MAX_STUDIO_SCREENSHOT_MESSAGE_BYTES,
  MAX_STUDIO_TREE_MESSAGE_BYTES,
  MAX_STUDIO_TREE_MESSAGE_DEPTH,
  MAX_STUDIO_TREE_MESSAGE_NODES,
} from "#veryfront/studio/limits.ts";

const MAX_PENDING_MESSAGES = 100;
const MAX_PENDING_SCREENSHOT_MESSAGES = 20;
const MAX_PENDING_RUNTIME_ERRORS = 20;
// A complete navigator snapshot can legitimately approach its 32 MiB
// transport budget before Studio establishes the target origin. Reserve one
// such slot plus bounded headroom for lifecycle messages.
const MAX_PENDING_BYTES = MAX_STUDIO_TREE_MESSAGE_BYTES + 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 1024 * 1024;
// Screenshot replies have a separate lane so a requested capture cannot be
// displaced by console or navigator traffic. The lane holds one maximum-size
// capture plus bounded room for small concurrent-request failure responses.
const MAX_PENDING_SCREENSHOT_BYTES = MAX_STUDIO_SCREENSHOT_MESSAGE_BYTES + MAX_MESSAGE_BYTES;
const MAX_MESSAGES_PER_FLUSH = 8;
const FLUSH_INTERVAL_MS = 16;
const MAX_MESSAGE_NODES = 10_000;
const MAX_MESSAGE_DEPTH = 32;
const MAX_COLLECTION_ENTRIES = 5_000;
const MAX_PROPERTY_NAME_LENGTH = 256;

interface PendingMessage {
  message: Record<string, unknown>;
  bytes: number;
  action: string | null;
  priority: MessagePriority;
  screenshot: boolean;
  successfulScreenshot: boolean;
}

const enum MessagePriority {
  Low,
  Normal,
  Critical,
}

const CRITICAL_ACTIONS = new Set([
  "appLoaded",
  "appUnloaded",
  "appUpdated",
  "onPageTransitionStart",
  "onPageTransitionEnd",
  "runtimeError",
  "screenshotResult",
  "setSelectedNode",
  "treeUpdated",
]);

const COALESCED_ACTIONS = new Set(["appUpdated", "setSelectedNode", "treeUpdated"]);
// Navigation notifications must enter the browser's postMessage task queue
// before teardown. Selection is user-driven state and must update without a
// scheduler-frame delay; its event sources are already bounded by user input.
const IMMEDIATE_ACTIONS = new Set([
  "appUnloaded",
  "onPageTransitionStart",
  "setSelectedNode",
]);
const ORDERING_DEPENDENT_LIFECYCLE_ACTIONS = new Set([
  "appLoaded",
  "appUpdated",
  "onPageTransitionEnd",
]);
const PRE_UNLOAD_LIFECYCLE_ACTIONS = new Set([
  ...ORDERING_DEPENDENT_LIFECYCLE_ACTIONS,
  "onPageTransitionStart",
]);
const PROTECTED_ACTIONS = new Set([
  "appLoaded",
  "appUnloaded",
  "appUpdated",
  "onPageTransitionStart",
  "onPageTransitionEnd",
  "screenshotResult",
  "setSelectedNode",
  "treeUpdated",
]);

interface SnapshotBudget {
  bytes: number;
  limit: number;
  nodes: number;
  nodeLimit: number;
  depthLimit: number;
  seen: Set<object>;
}

interface SnapshotLimits {
  bytes: number;
  nodes: number;
  depth: number;
}

const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  bytes: MAX_MESSAGE_BYTES,
  nodes: MAX_MESSAGE_NODES,
  depth: MAX_MESSAGE_DEPTH,
};

const INVALID_SNAPSHOT = Symbol("invalid-studio-message-snapshot");

function accountBytes(budget: SnapshotBudget, bytes: number): boolean {
  budget.bytes += bytes;
  return budget.bytes <= budget.limit;
}

function snapshotValue(
  value: unknown,
  budget: SnapshotBudget,
  depth: number,
): unknown | typeof INVALID_SNAPSHOT {
  if (++budget.nodes > budget.nodeLimit || depth > budget.depthLimit) return INVALID_SNAPSHOT;
  if (value === null) return accountBytes(budget, 4) ? null : INVALID_SNAPSHOT;
  if (value === undefined) return accountBytes(budget, 9) ? undefined : INVALID_SNAPSHOT;
  if (typeof value === "boolean") return accountBytes(budget, 5) ? value : INVALID_SNAPSHOT;
  if (typeof value === "number") {
    return Number.isFinite(value) && accountBytes(budget, 16) ? value : INVALID_SNAPSHOT;
  }
  if (typeof value === "string") {
    return value.length <= budget.limit && accountBytes(budget, value.length * 2)
      ? value
      : INVALID_SNAPSHOT;
  }
  if (typeof value !== "object") return INVALID_SNAPSHOT;
  if (budget.seen.has(value)) return INVALID_SNAPSHOT;
  budget.seen.add(value);

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);

    if (Array.isArray(value)) {
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (
        typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
        length > MAX_COLLECTION_ENTRIES || keys.length !== length + 1 || keys.some((key) =>
          typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))
        )
      ) {
        return INVALID_SNAPSHOT;
      }

      const output: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
          return INVALID_SNAPSHOT;
        }
        const item = snapshotValue(descriptor.value, budget, depth + 1);
        if (item === INVALID_SNAPSHOT) {
          return INVALID_SNAPSHOT;
        }
        output.push(item);
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_SNAPSHOT;
    if (keys.length > MAX_COLLECTION_ENTRIES || keys.some((key) => typeof key !== "string")) {
      return INVALID_SNAPSHOT;
    }

    const output: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (
        key.length > MAX_PROPERTY_NAME_LENGTH || key.includes("\0") || !descriptor.enumerable ||
        descriptor.get || descriptor.set || !accountBytes(budget, key.length * 2)
      ) return INVALID_SNAPSHOT;
      const item = snapshotValue(descriptor.value, budget, depth + 1);
      if (item === INVALID_SNAPSHOT) return INVALID_SNAPSHOT;
      Object.defineProperty(output, key, {
        value: item,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  } catch {
    return INVALID_SNAPSHOT;
  } finally {
    budget.seen.delete(value);
  }
}

function snapshotMessage(
  message: Record<string, unknown>,
): { message: Record<string, unknown>; bytes: number } | null {
  const action = readOwnAction(message);
  const limits = action === "screenshotResult"
    ? { ...DEFAULT_SNAPSHOT_LIMITS, bytes: MAX_STUDIO_SCREENSHOT_MESSAGE_BYTES }
    : action === "treeUpdated"
    ? {
      bytes: MAX_STUDIO_TREE_MESSAGE_BYTES,
      nodes: MAX_STUDIO_TREE_MESSAGE_NODES,
      depth: MAX_STUDIO_TREE_MESSAGE_DEPTH,
    }
    : DEFAULT_SNAPSHOT_LIMITS;
  const snapshot = snapshotStudioValueWithLimits(message, limits);
  return snapshot && snapshot.value && !Array.isArray(snapshot.value) &&
      typeof snapshot.value === "object"
    ? { message: snapshot.value as Record<string, unknown>, bytes: snapshot.bytes }
    : null;
}

function readOwnAction(message: Record<string, unknown>): string | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(message, "action");
    return descriptor?.enumerable && !descriptor.get && !descriptor.set &&
        typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function isSuccessfulScreenshot(
  message: Record<string, unknown>,
  action: string | null,
): boolean {
  if (action !== "screenshotResult") return false;
  if (Object.getOwnPropertyDescriptor(message, "success")?.value === true) return true;

  const results = Object.getOwnPropertyDescriptor(message, "results")?.value;
  return Array.isArray(results) &&
    results.some((result) =>
      result !== null && typeof result === "object" &&
      Object.getOwnPropertyDescriptor(result, "success")?.value === true
    );
}

function snapshotStudioValueWithLimits(
  value: unknown,
  limits: SnapshotLimits,
): { value: unknown; bytes: number } | null {
  const budget: SnapshotBudget = {
    bytes: 0,
    limit: limits.bytes,
    nodes: 0,
    nodeLimit: limits.nodes,
    depthLimit: limits.depth,
    seen: new Set(),
  };
  const snapshot = snapshotValue(value, budget, 0);
  return snapshot !== INVALID_SNAPSHOT ? { value: snapshot, bytes: budget.bytes } : null;
}

/** Create a bounded, descriptor-safe value for the Studio postMessage boundary. */
export function snapshotStudioValue(value: unknown): { value: unknown; bytes: number } | null {
  return snapshotStudioValueWithLimits(value, DEFAULT_SNAPSHOT_LIMITS);
}

let studioOrigin: string | null = null;
const pendingMessages: PendingMessage[] = [];
let pendingBytes = 0;
let pendingScreenshotBytes = 0;
let pendingScreenshotMessages = 0;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleUnloaded = false;

function send(message: Record<string, unknown>, origin: string): boolean {
  try {
    globalThis.window.parent.postMessage(message, origin);
    return true;
  } catch {
    // A detached, bounded payload can still fail if the browsing context closes.
    return false;
  }
}

function messagePriority(action: string | null): MessagePriority {
  if (action === "logEvent") return MessagePriority.Low;
  return action && CRITICAL_ACTIONS.has(action) ? MessagePriority.Critical : MessagePriority.Normal;
}

function removePendingAt(index: number): PendingMessage | null {
  const [removed] = pendingMessages.splice(index, 1);
  if (!removed) return null;
  if (removed.screenshot) {
    pendingScreenshotBytes -= removed.bytes;
    pendingScreenshotMessages--;
  } else {
    pendingBytes -= removed.bytes;
  }
  return removed;
}

function capPendingAction(action: string, maximum: number): void {
  let count = 0;
  for (const pending of pendingMessages) {
    if (pending.action === action) count++;
  }
  while (count >= maximum) {
    const index = pendingMessages.findIndex((pending) => pending.action === action);
    if (index < 0) return;
    removePendingAt(index);
    count--;
  }
}

function makePendingMessage(
  snapshot: { message: Record<string, unknown>; bytes: number },
): PendingMessage {
  const action = readOwnAction(snapshot.message);
  return {
    ...snapshot,
    action,
    priority: messagePriority(action),
    screenshot: action === "screenshotResult",
    successfulScreenshot: isSuccessfulScreenshot(snapshot.message, action),
  };
}

function makePendingRoom(incoming: PendingMessage): boolean {
  if (incoming.screenshot) {
    if (incoming.bytes > MAX_PENDING_SCREENSHOT_BYTES) return false;
    while (
      pendingScreenshotMessages >= MAX_PENDING_SCREENSHOT_MESSAGES ||
      pendingScreenshotBytes + incoming.bytes > MAX_PENDING_SCREENSHOT_BYTES
    ) {
      // Under a screenshot-request flood, retain the most recent bounded
      // responses without allowing busy/error replies to displace a completed
      // capture. This lane is isolated from application lifecycle state.
      let dropIndex = pendingMessages.findIndex((pending) =>
        pending.screenshot && !pending.successfulScreenshot
      );
      if (dropIndex < 0) {
        if (!incoming.successfulScreenshot) return false;
        dropIndex = pendingMessages.findIndex((pending) => pending.screenshot);
      }
      if (dropIndex < 0) return false;
      removePendingAt(dropIndex);
    }
    return true;
  }

  if (incoming.bytes > MAX_PENDING_BYTES) return false;

  while (
    pendingMessages.length - pendingScreenshotMessages >= MAX_PENDING_MESSAGES ||
    pendingBytes + incoming.bytes > MAX_PENDING_BYTES
  ) {
    let lowestPriority = MessagePriority.Critical;
    for (const pending of pendingMessages) {
      if (pending.screenshot) continue;
      if (pending.priority < lowestPriority) lowestPriority = pending.priority;
    }

    if (
      pendingMessages.length === pendingScreenshotMessages || lowestPriority > incoming.priority
    ) return false;
    let dropIndex = pendingMessages.findIndex((pending) =>
      !pending.screenshot && pending.priority === lowestPriority &&
      (!pending.action || !PROTECTED_ACTIONS.has(pending.action))
    );
    if (dropIndex < 0) {
      if (!incoming.action || !PROTECTED_ACTIONS.has(incoming.action)) return false;
      dropIndex = pendingMessages.findIndex((pending) =>
        !pending.screenshot && pending.priority === lowestPriority
      );
    }
    if (dropIndex < 0) return false;
    removePendingAt(dropIndex);
  }

  return true;
}

function enqueuePending(pending: PendingMessage): boolean {
  if (pending.action && COALESCED_ACTIONS.has(pending.action)) {
    const existingIndex = pendingMessages.findIndex((entry) => entry.action === pending.action);
    if (existingIndex >= 0) removePendingAt(existingIndex);
  }
  if (pending.action === "runtimeError") {
    capPendingAction(pending.action, MAX_PENDING_RUNTIME_ERRORS);
  }
  if (!makePendingRoom(pending)) return false;
  pendingMessages.push(pending);
  if (pending.screenshot) {
    pendingScreenshotBytes += pending.bytes;
    pendingScreenshotMessages++;
  } else {
    pendingBytes += pending.bytes;
  }
  return true;
}

function discardQueuedSessionTraffic(): void {
  for (let index = pendingMessages.length - 1; index >= 0; index--) {
    const action = pendingMessages[index]!.action;
    if (action && PRE_UNLOAD_LIFECYCLE_ACTIONS.has(action)) continue;
    removePendingAt(index);
  }
}

function nextPendingIndex(): number {
  let selectedIndex = -1;
  let selectedPriority = MessagePriority.Low;
  for (let index = 0; index < pendingMessages.length; index++) {
    const priority = pendingMessages[index]!.priority;
    if (selectedIndex < 0 || priority > selectedPriority) {
      selectedIndex = index;
      selectedPriority = priority;
      if (priority === MessagePriority.Critical) break;
    }
  }
  return selectedIndex;
}

function flushPendingBatch(maximum = MAX_MESSAGES_PER_FLUSH): void {
  if (!studioOrigin) return;
  const origin = studioOrigin;
  for (let sent = 0; sent < maximum && studioOrigin === origin; sent++) {
    const index = nextPendingIndex();
    if (index < 0) return;
    const pending = removePendingAt(index);
    if (!pending) return;
    send(pending.message, origin);
  }
}

function schedulePendingFlush(): void {
  if (!studioOrigin || pendingMessages.length === 0 || pendingFlushTimer !== null) return;
  pendingFlushTimer = globalThis.setTimeout(() => {
    pendingFlushTimer = null;
    flushPendingBatch();
    schedulePendingFlush();
  }, FLUSH_INTERVAL_MS);
}

function sendImmediateMessage(target: PendingMessage): boolean {
  if (!studioOrigin) return false;
  const origin = studioOrigin;
  const targetIndex = pendingMessages.indexOf(target);
  if (targetIndex < 0) return false;

  const predecessors = pendingMessages.slice(0, targetIndex).filter((pending) =>
    pending.action !== null && ORDERING_DEPENDENT_LIFECYCLE_ACTIONS.has(pending.action)
  );
  // Each predecessor action represents the latest state for one lifecycle
  // phase. Collapse duplicate internal traffic and send the phases in protocol
  // order, which structurally keeps this path below the scheduler batch bound.
  const latestPredecessorByAction = new Map<string, PendingMessage>();
  for (const predecessor of predecessors) {
    latestPredecessorByAction.set(predecessor.action!, predecessor);
    const index = pendingMessages.indexOf(predecessor);
    if (index < 0 || !removePendingAt(index)) return false;
  }
  for (const action of ORDERING_DEPENDENT_LIFECYCLE_ACTIONS) {
    if (studioOrigin !== origin) return false;
    const predecessor = latestPredecessorByAction.get(action);
    if (predecessor) send(predecessor.message, origin);
  }

  if (studioOrigin !== origin) return false;
  const currentTargetIndex = pendingMessages.indexOf(target);
  if (currentTargetIndex < 0 || !removePendingAt(currentTargetIndex)) return false;
  return send(target.message, origin);
}

export function postToStudio(message: MessageFromRenderer): boolean {
  if (!globalThis.window.parent || globalThis.window.parent === globalThis.window) return false;
  const snapshot = snapshotMessage(message);
  if (!snapshot) return false;
  const pending = makePendingMessage(snapshot);
  if (
    lifecycleUnloaded && pending.action !== "appLoaded" &&
    pending.action !== "appUnloaded"
  ) return false;
  if (pending.action === "appLoaded") lifecycleUnloaded = false;
  if (pending.action === "appUnloaded") {
    discardQueuedSessionTraffic();
    lifecycleUnloaded = true;
  }
  if (!enqueuePending(pending)) return false;
  if (studioOrigin && pending.action && IMMEDIATE_ACTIONS.has(pending.action)) {
    // Preserve ordering-dependent lifecycle state without synchronously
    // draining unrelated errors, screenshots, or navigator snapshots.
    const sent = sendImmediateMessage(pending);
    schedulePendingFlush();
    return sent;
  }
  schedulePendingFlush();
  return true;
}

export function isFromStudio(event: MessageEvent): boolean {
  if (!globalThis.window.parent || event.source !== globalThis.window.parent) return false;

  const trustedOrigin = resolveTrustedStudioOrigin(event.origin || "");
  if (!trustedOrigin) return false;

  if (studioOrigin) {
    return trustedOrigin === studioOrigin;
  }

  studioOrigin = trustedOrigin;
  schedulePendingFlush();
  return true;
}

/** Release the target origin and buffered payloads owned by this bridge session. */
export function disposeMessaging(): void {
  if (pendingFlushTimer !== null) {
    globalThis.clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  studioOrigin = null;
  pendingMessages.length = 0;
  pendingBytes = 0;
  pendingScreenshotBytes = 0;
  pendingScreenshotMessages = 0;
  lifecycleUnloaded = false;
}

/** Test-only: reset module state. Not exported from the public surface. */
export function _resetForTest(): void {
  disposeMessaging();
}

/** Test-only: read pending buffer length. */
export function _pendingCountForTest(): number {
  return pendingMessages.length;
}

/** Test-only: synchronously drain accepted messages without timer coupling. */
export function _flushPendingForTest(): void {
  if (pendingFlushTimer !== null) {
    globalThis.clearTimeout(pendingFlushTimer);
    pendingFlushTimer = null;
  }
  flushPendingBatch(Number.POSITIVE_INFINITY);
}
