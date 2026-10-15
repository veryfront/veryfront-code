import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

// A fresh production-mode process pins the operator key before any tenant code.
// Only the final MCP transport is mocked; signature, private owner, real platform
// source, runtime stream and local wrapper execution use production code.
const program = `
import "#veryfront/schemas/_test-setup.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { createCtx, createAgentWithConfig } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { withVeryfrontPlatformRemoteTools } from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import { registerPlatformDependencyOwner, capturePlatformDependencySource, runWithPlatformDependencyOwner } from "#veryfront/agent/service/auth.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { dynamicTool } from "#veryfront/tool";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
const scope = {projectId:"proj-1",runId:"run-1",agentId:"intake-agent"};
const claims = await verifyControlPlaneRequest(new Request("https://veryfront.test/api/control-plane/runs/run-1/stream",{method:"POST",headers:{"x-veryfront-control-plane-jws":data.jws}}),createCtx(data.publicKeyPem),data.body);
const input = {runId:scope.runId,agentId:scope.agentId,threadId:"platform-thread",messages:[],tools:[],context:[]};
registerPlatformDependencyOwner(input,claims,scope);
let effects=0, saved;
const wrapper=dynamicTool({id:"intake",description:"Intake",inputSchema:{},delegatedPlatformTools:["veryfront__create_file"],execute:async(_,context)=>{saved=context.executePlatformTool;return await saved("veryfront__create_file",{path:"qualification.txt",content:"fixture",project_reference:"foreign"});}});
await withMockFetch(async(_url,init)=>{
 const body=JSON.parse(String(init.body));
 if(body.method==="tools/call") { if(body.params.arguments.project_reference!==scope.projectId||body.params._meta.run_id!==scope.runId)throw new Error("Wrong transport scope"); effects++; }
 return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="tools/list"?{tools:[{name:"create_file",description:"Create",inputSchema:{type:"object",properties:{project_reference:{type:"string"},path:{type:"string"},content:{type:"string"}}}}]}:{content:[{type:"text",text:"accepted"}]}}),{headers:{"content-type":"application/json"}});
},async()=>{
 const agent=await withVeryfrontPlatformRemoteTools({agent:createAgentWithConfig(scope.agentId,{tools:{intake:wrapper},mcpServers:[{kind:"veryfront-api",toolPolicy:{allow:[]}}]}),token:"fixture-token",projectId:scope.projectId,programmaticPlatformRunId:scope.runId,programmaticPlatformToolNames:["veryfront__create_file"],captureProgrammaticPlatformSource:source=>capturePlatformDependencySource(input,source)});
 if((Reflect.get(agent.config,"__vfAllowedRemoteTools")??[]).length) throw new Error("Dependency exposed to model");
 const response=await createRuntimeAgentStreamResponse(input,agent,{sessionManager:new AgentRunSessionManager(),createRuntime:()=>({stream:async()=>new ReadableStream({async pull(controller){await executeConfiguredTool("intake",{},{intake:wrapper},scope,[],[]);controller.close();}})})});
 await response.text();
});
if(effects!==1)throw new Error("Expected exactly one platform effect");
let revoked=false;try{await runWithPlatformDependencyOwner(input,async()=>saved("veryfront__create_file",{}));}catch{revoked=true;}
if(!revoked||effects!==1)throw new Error("Settled stream retained authority");
console.log(JSON.stringify({effects,revoked,modelCalls:0}));
`;

Deno.test("operator proof reaches a hidden platform source through actual runtime stream pulls", async () => {
  const body = JSON.stringify({
    run: { runId: "run-1", agentId: "intake-agent", project: { projectId: "proj-1" } },
    platformToolDependencies: [{ toolId: "intake", platformTools: ["veryfront__create_file"] }],
  });
  const signed = await createControlPlaneSignature(body);
  const env: Record<string, string> = {
    DENO_TESTING: "0",
    NODE_ENV: "production",
    VERYFRONT_API_URL: "https://8.8.8.8",
    CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: signed.publicKeyPem,
  };
  for (const key of ["HOME", "DENO_DIR"]) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  const child = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config", "deno.json", program],
    clearEnv: true,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({ body, ...signed })));
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(output.stdout).trim().split("\n").at(-1)!), {
    effects: 1,
    revoked: true,
    modelCalls: 0,
  });
});
