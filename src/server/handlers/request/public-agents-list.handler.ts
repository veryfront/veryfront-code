import {
  listRuntimeAgents,
  type RuntimeAgentDiscoveryDeps,
  type RuntimeAgentPublicMetadata,
} from "#veryfront/channels/control-plane.ts";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";

const PUBLIC_AGENTS_LIST_PATH = "/api/agents";

/**
 * Browser-facing `GET /api/agents`. Returns the same browser-safe metadata as
 * {@link PublicAgentMetadataHandler}, but for every discovered agent, sorted by
 * name. Backs the {@link useAgents} React hook. Unlike the control-plane list
 * endpoint this is unsigned and public, so it exposes only the narrowed public
 * metadata (id / name / description / avatar_url / suggestions), never model,
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

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      const discovered = await listRuntimeAgents(ctx, this.deps);
      const agents: RuntimeAgentPublicMetadata[] = discovered.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        ...(agent.avatar_url === undefined ? {} : { avatar_url: agent.avatar_url }),
        ...(agent.suggestions === undefined ? {} : { suggestions: agent.suggestions }),
      }));

      return this.respond(builder.json({ agents }, 200));
    });
  }
}
