import {
  getRuntimeAgentPublicMetadata,
  type RuntimeAgentDiscoveryDeps,
  type RuntimeAgentPublicMetadata,
} from "#veryfront/channels/control-plane.ts";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";

const PUBLIC_AGENTS_LIST_PATH = "/api/agents";

/**
 * Browser-facing `GET /api/agents` — returns the same browser-safe metadata as
 * {@link PublicAgentMetadataHandler}, but for every discovered agent, sorted by
 * name. Backs the {@link useAgents} React hook. Unlike the control-plane list
 * endpoint this is unsigned and public, so it exposes only the narrowed public
 * metadata (id / name / description / avatar_url / suggestions) — never model,
 * version, or resolved skills.
 */
export class PublicAgentsListHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "PublicAgentsListHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: PUBLIC_AGENTS_LIST_PATH, exact: true, method: "GET" },
    ],
  };

  constructor(private readonly deps: RuntimeAgentDiscoveryDeps = defaultChannelInvokeDeps) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    if (requiresIsolatedProjectRuntime(ctx)) {
      const problem = createErrorResponseFromDefinition(
        PROJECT_EXECUTION_UNAVAILABLE,
        {
          detail:
            "Shared runtimes require a dedicated isolated project runtime for agent discovery",
          instance: PUBLIC_AGENTS_LIST_PATH,
        },
      );
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders(problem.headers)
        .build(problem.body, problem.status);
      return this.respond(response);
    }

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      await this.deps.ensureProjectDiscovery(ctx);

      const agents: RuntimeAgentPublicMetadata[] = this.deps.getAllAgentIds()
        .map((id) => ({ id, agent: this.deps.getAgent(id) }))
        .filter((entry): entry is { id: string; agent: NonNullable<typeof entry.agent> } =>
          Boolean(entry.agent)
        )
        .map(({ id, agent }) => getRuntimeAgentPublicMetadata(id, agent))
        .sort((left, right) => left.name.localeCompare(right.name));

      return this.respond(builder.json({ agents }, 200));
    });
  }
}
