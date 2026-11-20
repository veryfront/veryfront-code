import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { HandlerContext } from "#veryfront/types";

const trim = String.prototype.trim;
const apply = Reflect.apply;

export type ApplicationWorkflowSource =
  | { type: "environment"; environmentName: string; releaseId: string }
  | { type: "branch"; branchName: string | null };

/** Use the same source that the host selected for the route's project filesystem. */
export function resolveApplicationWorkflowSource(
  ctx: HandlerContext,
): ApplicationWorkflowSource | undefined {
  const mode = ctx.requestContext?.mode ?? ctx.resolvedEnvironment;
  if (ctx.isLocalProject || (ctx.resolvedEnvironment && mode !== ctx.resolvedEnvironment)) {
    return undefined;
  }
  if (mode === "preview") {
    const name = ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null;
    const ref = name && apply(trim, name, []);
    // FileResolver treats these legacy branch references as the default branch.
    const isDefault = !ref || ref === "main" || ref === "00000000-0000-0000-0000-000000000000";
    return { type: "branch", branchName: isDefault ? null : name };
  }
  if (mode === "production" && ctx.releaseId && ctx.environmentName) {
    return { type: "environment", environmentName: ctx.environmentName, releaseId: ctx.releaseId };
  }
  return undefined;
}

interface HostedWorkflowIdentity {
  projectId: string;
  projectSlug: string;
  source: ApplicationWorkflowSource;
}
const freeze = Object.freeze;
const identities = createPrivateWeakStore<HandlerContext, Readonly<HostedWorkflowIdentity>>();

/** Snapshot only the project resolved by authenticated ingress or a fixed installation. */
export function bindApplicationWorkflowIdentity(ctx: HandlerContext): void {
  const source = resolveApplicationWorkflowSource(ctx);
  if (ctx.projectId && ctx.projectSlug && source) {
    identities.set(
      ctx,
      freeze({ projectId: ctx.projectId, projectSlug: ctx.projectSlug, source: freeze(source) }),
    );
  }
}

export function getApplicationWorkflowIdentity(
  ctx: HandlerContext,
): Readonly<HostedWorkflowIdentity> | undefined {
  return identities.get(ctx);
}
