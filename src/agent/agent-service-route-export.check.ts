import {
  agent,
  type AgentServiceRoute,
  createAgentServiceServerRuntime,
  defineAgentService,
} from "./index.ts";

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
