import { chainPrivatePromise } from "#veryfront/security/private-promise.ts";
import {
  createPrivateReadableStream,
  getPrivateStreamReader,
} from "#veryfront/security/private-stream.ts";
import type { HostedAcceptedChildEvidence } from "./accepted-child-evidence.ts";
import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import type { HostedAcceptedTaskInputEvent } from "./accepted-task-input.ts";
export type HostedChildTaskInputResolver = (
  input: Readonly<
    {
      projectId: string;
      rootRunId?: string;
      parentRunId: string;
      targetAgentId: string;
      toolCallId: string;
      evidence: HostedAcceptedChildEvidence;
    }
  >,
) => Promise<Omit<HostedAcceptedTaskInputEvent, "type" | "version" | "targetAgentId"> | undefined>;
type Scope = { active: boolean; resolver: HostedChildTaskInputResolver };
const storage = createPrivateAsyncLocalStorage<Scope | undefined>();
const freeze = Object.freeze;
const NativeResponse = Response;
const apply = Reflect.apply;
const responseBody = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")!.get!;
const responseStatus = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "status")!.get!;
const responseStatusText = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "statusText")!
  .get!;
const responseHeaders = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "headers")!.get!;
const hasInstance = Function.prototype[Symbol.hasInstance];
/** Select deterministic receipts until the parent returns or its response source closes. */
export async function withHostedChildTaskInputResolver<T>(
  resolver: HostedChildTaskInputResolver | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!resolver) return storage.run(undefined, operation);
  const scope = { active: true, resolver };
  let streaming = false;
  try {
    const result = await storage.run(scope, operation);
    const resultBody = apply(hasInstance, NativeResponse, [result])
      ? apply(responseBody, result, []) as ReadableStream<Uint8Array> | null
      : null;
    if (resultBody) {
      const reader = getPrivateStreamReader(resultBody);
      const revoke = () => {
        scope.active = false;
      };
      void chainPrivatePromise(reader.closed, revoke, revoke);
      const body = createPrivateReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await storage.run(scope, () => reader.read());
            if (chunk.done) {
              scope.active = false;
              controller.close();
            } else {
              controller.enqueue(chunk.value);
            }
          } catch (error) {
            scope.active = false;
            controller.error(error);
          }
        },
        async cancel(reason) {
          scope.active = false;
          await reader.cancel(reason);
        },
      });
      const responseInit = {
        __proto__: null,
        status: apply(responseStatus, result, []) as number,
        statusText: apply(responseStatusText, result, []) as string,
        headers: apply(responseHeaders, result, []) as Headers,
      };
      const response = new NativeResponse(body, responseInit);
      streaming = true;
      return response as T;
    }
    return result;
  } finally {
    if (!streaming) scope.active = false;
  }
}
export function getHostedChildTaskInputResolver(): HostedChildTaskInputResolver | undefined {
  const scope = storage.getStore();
  if (!scope?.active) return undefined;
  const resolver = scope.resolver;
  const whileActive = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!scope.active) throw new Error("Accepted child input resolver is no longer active");
    const result = await operation();
    if (!scope.active) throw new Error("Accepted child input resolver is no longer active");
    return result;
  };
  return (input) => {
    const evidence = input.evidence;
    return whileActive(() =>
      resolver(freeze({
        ...input,
        evidence: freeze({
          readParentToolResults: () => whileActive(() => evidence.readParentToolResults()),
          readCommittedVersion: (path: string, versionId: string) =>
            whileActive(() => evidence.readCommittedVersion(path, versionId)),
        }),
      }))
    );
  };
}

/** @internal Give scheduled framework execution its own lifetime before acknowledging the request. */
export function runWithHostedChildTaskInputExecution<T>(operation: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  return withHostedChildTaskInputResolver(scope?.active ? scope.resolver : undefined, operation);
}
