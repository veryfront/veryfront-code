import {
  getRuntimeAgentPublicMetadata,
  type RuntimeAgentDiscoveryDeps,
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

const PUBLIC_AGENT_METADATA_PATH = /^\/api\/agents\/([^/]+)$/;

function getAgentIdFromPath(pathname: string): string | null {
  const match = PUBLIC_AGENT_METADATA_PATH.exec(pathname);
  if (!match?.[1]) return null;

  try {
    const agentId = decodeURIComponent(match[1]).trim();
    return agentId.length > 0 ? agentId : null;
  } catch {
    return null;
  }
}

export class PublicAgentMetadataHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "PublicAgentMetadataHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: PUBLIC_AGENT_METADATA_PATH, method: "GET" },
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
          instance: new URL(req.url).pathname,
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

      const { pathname } = new URL(req.url);
      const agentId = getAgentIdFromPath(pathname);
      if (!agentId) {
        return this.respond(builder.json({ error: "Invalid agent id" }, 400));
      }

      await this.deps.ensureProjectDiscovery(ctx);
      const agent = this.deps.getAgent(agentId);
      if (!agent) {
        return this.respond(builder.json({ error: "Agent not found" }, 404));
      }

      return this.respond(
        builder.json({ agent: getRuntimeAgentPublicMetadata(agentId, agent) }, 200),
      );
    });
  }
}
