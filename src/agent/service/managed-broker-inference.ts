import type { ManagedExecutorStartInput } from "../hosted/managed-executor-broker.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortGuard,
  registerModelRuntimeResolverRevoker,
  revokeModelRuntimeResolver,
} from "../runtime/model-transport.ts";

/**
 * Bind verified ingress authority to broker-side model dispatch. This belongs
 * in the trusted process, which must never import project-authored code. The
 * executor receives model protocol data, never this resolver or its credential.
 */
export function bindManagedBrokerInferenceAuthority(options: {
  start: ManagedExecutorStartInput;
  createResolver: () => AgentModelRuntimeResolver | undefined;
  signal: AbortSignal;
  cleanup?: () => Promise<void>;
}): { start: ManagedExecutorStartInput; cleanup?: () => Promise<void> } {
  const fallback = options.start.model?.resolver;
  if (typeof fallback !== "function") {
    throw new TypeError("Managed broker model resolver is required");
  }
  const authority = options.createResolver();
  if (!authority) return { start: options.start, cleanup: options.cleanup };
  // A verified run credential replaces ambient model authority for this
  // namespace. An unavailable/refusing scoped resolver must never fall back.
  const resolver: AgentModelRuntimeResolver = (modelId) =>
    modelId.startsWith("veryfront-cloud/") ? authority(modelId) : fallback(modelId);
  registerModelRuntimeResolverRevoker(resolver, () => revokeModelRuntimeResolver(authority));
  const guard = createModelRuntimeResolverAbortGuard(resolver, options.signal);
  let retirement: Promise<void> | undefined;
  return {
    start: { ...options.start, model: { ...options.start.model, resolver } },
    cleanup: () => {
      retirement ??= (async () => {
        const errors: unknown[] = [];
        // Revoke before any adapter cleanup callback can start more inference.
        try {
          guard.dispose();
        } catch (error) {
          errors.push(error);
        }
        try {
          await options.cleanup?.();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
          throw new AggregateError(errors, "Broker inference retirement and cleanup failed");
        }
      })();
      return retirement;
    },
  };
}
