import {
  agent,
  type AgentServiceRoute,
  createAgentServiceServerRuntime,
  type DefaultHostedChatRuntimeCreationOptions,
  defineAgentService,
  type HostedDurableChildExecutionOptions,
  type ParsedHostedChatRequest,
  type PrepareHostedConversationRootRunContextInput,
} from "../index.ts";

type ForbiddenRunEventAuthorityKey = "runEventAppendToken" | "runEventWriterCapability";
type HasNoRunEventAuthorityKey<T> = Extract<keyof T, ForbiddenRunEventAuthorityKey> extends never
  ? true
  : false;

const publicRunEventAuthorityBoundary: [
  HasNoRunEventAuthorityKey<ParsedHostedChatRequest>,
  HasNoRunEventAuthorityKey<PrepareHostedConversationRootRunContextInput>,
  HasNoRunEventAuthorityKey<DefaultHostedChatRuntimeCreationOptions>,
  HasNoRunEventAuthorityKey<HostedDurableChildExecutionOptions>,
] = [true, true, true, true];
void publicRunEventAuthorityBoundary;

const routes: AgentServiceRoute[] = [
  {
    method: "GET",
    path: "/custom/:id",
    handler: (_request, params) => Response.json({ id: params.id }),
  },
];

const service = defineAgentService({
  serviceName: "route-type-check-service",
  agent: agent({
    id: "route-type-check-agent",
    system: "Type-check the hosted route export.",
  }),
});

service.createRuntime({ routes });
createAgentServiceServerRuntime({ runtime: service.createRuntime({ routes }) });
