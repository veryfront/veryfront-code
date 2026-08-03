import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema/zod-json-schema.ts";
import { getProviderToolProfile } from "./provider-tool-compat.ts";
import type { RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";

/** Options accepted by the load_tools tool. */
export type LoadToolsToolOptions = {
  context: RuntimeToolDiscoveryContext;
  /**
   * Names that are always present in the run (local/essential tools).
   * These count toward the provider budget and can never be evicted.
   */
  pinnedToolNames: readonly string[];
  /** Model identifier used to resolve the provider tool budget. */
  model?: string;
  /**
   * Returns the names of every remote tool the current run is authorized to
   * use. Unknown and unauthorized tool names are both treated as unknown_tool
   * (same reason) to avoid leaking existence of unauthorized tools.
   */
  getAuthorizedToolNames: () => readonly string[];
  /**
   * When set to a non-null Set, activation candidates are intersected with
   * this policy before the authorized-catalog check. Names that are in the
   * authorized catalog but outside the binding policy receive the same
   * `unknown_tool` reason as genuinely unknown names — no distinguishability.
   * null or undefined means unrestricted: the full authorized catalog applies.
   */
  bindingPolicy?: ReadonlySet<string> | null;
};

/** Input payload for load_tools. */
const getLoadToolsInputSchema = defineSchema((v) =>
  v.object({
    names: v.array(v.string().min(1)).min(1).describe(
      "Tool names to activate. All names must be valid; the call is atomic.",
    ),
  })
);

export type LoadToolsInput = InferSchema<ReturnType<typeof getLoadToolsInputSchema>>;

/** Successful activation output. */
export type LoadToolsSuccessOutput = {
  activated: string[];
  newlyActivated: string[];
  message: string;
};

/** Validation or budget-overflow failure output. */
export type LoadToolsErrorOutput = {
  error: string;
  reasons: Record<string, string>;
};

/** Output from load_tools. */
export type LoadToolsOutput = LoadToolsSuccessOutput | LoadToolsErrorOutput;

/** Create the load_tools host tool. */
export function createLoadToolsTool(
  options: LoadToolsToolOptions,
): Tool<LoadToolsInput, LoadToolsOutput> {
  function getActivatedSet(): Set<string> {
    if (!options.context.activatedRemoteToolNames) {
      options.context.activatedRemoteToolNames = new Set();
    }
    return options.context.activatedRemoteToolNames;
  }

  function execute(input: LoadToolsInput): LoadToolsOutput {
    // Intersect the full authorized catalog with the agent's binding policy.
    // Names outside the policy return the same unknown_tool reason as genuinely
    // unknown names so the policy boundary is not distinguishable to the model.
    const fullAuthorized = new Set(options.getAuthorizedToolNames());
    const authorized = options.bindingPolicy != null
      ? new Set([...fullAuthorized].filter((name) => options.bindingPolicy!.has(name)))
      : fullAuthorized;
    const activatedSet = getActivatedSet();

    // --- Validation pass (all-or-nothing) ---
    const reasons: Record<string, string> = {};
    for (const name of input.names) {
      if (!authorized.has(name)) {
        reasons[name] = "unknown_tool";
      }
    }

    if (Object.keys(reasons).length > 0) {
      options.context.onToolsActivationRejected?.(input.names, reasons);
      return {
        error:
          `Tool activation failed: one or more names are not in the authorized catalog for this run. ` +
          `Provide the per-name reason map to the user so they know which tools to connect.`,
        reasons,
      };
    }

    // --- Budget check ---
    const uniqueRequestedNames = [...new Set(input.names)];
    const newNames = uniqueRequestedNames.filter((n) => !activatedSet.has(n));
    const profile = getProviderToolProfile(options.model);

    if (profile.maxTools !== undefined) {
      const pinnedCount = new Set(options.pinnedToolNames).size;
      const total = pinnedCount + activatedSet.size + newNames.length;
      if (total > profile.maxTools) {
        const overflow = total - profile.maxTools;
        const rejectionReasons: Record<string, string> = {};
        for (const name of newNames) {
          rejectionReasons[name] = "budget_overflow";
        }
        options.context.onToolsActivationRejected?.(newNames, rejectionReasons);
        return {
          error:
            `Tool activation refused: adding ${newNames.length} tool(s) would exceed the provider ` +
            `budget of ${profile.maxTools} by ${overflow} (overflow: ${overflow}). ` +
            `Remove activated tools or choose a provider with a higher limit. ` +
            `Pinned: ${pinnedCount}, currently activated: ${activatedSet.size}, requested new: ${newNames.length}.`,
          reasons: rejectionReasons,
        };
      }
    }

    // --- Atomic activation ---
    for (const name of newNames) {
      activatedSet.add(name);
    }

    if (newNames.length > 0) {
      options.context.onToolsActivated?.(newNames);
    }

    const allActivated = uniqueRequestedNames;
    return {
      activated: allActivated,
      newlyActivated: newNames,
      message: newNames.length > 0
        ? `Activated ${newNames.length} tool(s): ${newNames.join(", ")}. ` +
          `These tools are callable from the next step.`
        : `All requested tools were already active: ${allActivated.join(", ")}.`,
    };
  }

  return {
    id: "load_tools",
    type: "function",
    description: "Activate one or more MCP tools for use in this run. " +
      "All names must be valid; the call is atomic (no partial activation). " +
      "Use search_tools first to discover available tool names and their current state. " +
      "Activated tools are callable from the next step. " +
      "The provider budget is enforced: if adding these tools would exceed the limit, the call " +
      "is refused with the exact overflow count.",
    inputSchema: getLoadToolsInputSchema(),
    get inputSchemaJson() {
      return zodToJsonSchema(getLoadToolsInputSchema());
    },
    execute: (input: LoadToolsInput) => Promise.resolve(execute(input)),
  };
}
