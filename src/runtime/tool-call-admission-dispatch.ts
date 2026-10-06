import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentRunToolCallAdmissionReceipt } from "./tool-call-admission-receipt.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const storage = new AsyncLocalStorage<{
  active: boolean;
  readonly receipt: Readonly<AgentRunToolCallAdmissionReceipt>;
  readonly assertActive: () => void;
  readonly source?: AdmitExecutorToolCall;
}>();

export type AdmitExecutorToolCall = (
  call: { occurrenceId: string; toolCallId: string },
  signal: AbortSignal,
) => Promise<AgentRunToolCallAdmissionReceipt>;

const owners = createPrivateWeakStore<
  AdmitExecutorToolCall,
  Readonly<{
    runId: string;
    canonicalRunId: string;
    projectId: string;
  }>
>();

/** Bind the callback to its privately held writer; these routing selectors confer no authority. */
export function bindToolCallAdmissionOwner(
  callback: AdmitExecutorToolCall,
  owner: { runId: string; canonicalRunId: string; projectId: string },
): void {
  if (owners.get(callback)) throw new TypeError("Tool-call admission owner already bound");
  owners.set(callback, Object.freeze({ ...owner }));
}

export function getToolCallAdmissionOwner(callback: AdmitExecutorToolCall) {
  return owners.get(callback);
}

/** Internal broker scope. Correlation fields in caller context never install a receipt. */
export async function runWithToolCallAdmissionReceipt<T>(
  receipt: AgentRunToolCallAdmissionReceipt,
  assertActive: () => void,
  operation: () => Promise<T>,
  source?: AdmitExecutorToolCall,
): Promise<T> {
  assertActive();
  const scope = { active: true, receipt: Object.freeze({ ...receipt }), assertActive, source };
  try {
    return await storage.run(scope, operation);
  } finally {
    scope.active = false;
  }
}

export function getCurrentToolCallAdmissionReceipt():
  | Readonly<AgentRunToolCallAdmissionReceipt>
  | undefined {
  const scope = storage.getStore();
  if (!scope?.active) return undefined;
  scope?.assertActive();
  return scope?.receipt;
}

/** Internal opaque callback identity, never a credential or caller-selected proof. */
export function getCurrentToolCallAdmissionSource(): AdmitExecutorToolCall | undefined {
  const scope = storage.getStore();
  if (!scope?.active) return undefined;
  scope.assertActive();
  return scope.source;
}
