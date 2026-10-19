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
import { createProjectEventWriter, bindProjectEventWriter } from "#veryfront/internal-agents/project-event-writer.ts";
import { introduceToolCallOccurrence, runWithToolCallOccurrenceDispatch } from "#veryfront/runtime/tool-call-occurrence.ts";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
const data = JSON.parse(await new Response(Deno.stdin.readable).text());
const scope = {projectId:"11111111-1111-4111-a111-111111111111",runId:"run-1",agentId:"intake-agent"};
const claims = await verifyControlPlaneRequest(new Request("https://veryfront.test/api/control-plane/runs/run-1/stream",{method:"POST",headers:{"x-veryfront-control-plane-jws":data.jws}}),{...createCtx(data.publicKeyPem),projectId:scope.projectId},data.body);
const input = {runId:scope.runId,agentId:scope.agentId,threadId:"33333333-3333-4333-a333-333333333333",messages:[],tools:[],context:[]};
registerPlatformDependencyOwner(input,claims,scope);
let effects=0, saved; const canonical="22222222-2222-4222-a222-222222222222"; let writer;
const wrapper=dynamicTool({id:"intake",description:"Intake",inputSchema:{},delegatedPlatformTools:[data.operation],execute:async(_,context)=>{saved=context.executePlatformTool;let denied=false;try{await saved("outlook__send_email",{});}catch(error){denied=String(error).includes("not admitted for this wrapper invocation");}if(!denied)throw new Error("Wrapper borrowed another operation");return await saved(data.operation,{...data.arguments,project_reference:"foreign"});}});
await withMockFetch(async(_url,init)=>{
 const body=JSON.parse(String(init.body));
 if(body.events){const start=body.tool_call_starts?.[0];return Response.json({latestEventId:2,latestExternalEventSequence:1,appendedCount:1,latest_event_id:2,latest_external_event_sequence:1,appended_count:1,tool_call_admissions:start?[{occurrence_id:start.occurrence_id,admission_event_id:"2",start_event_id:"1",tool_call_id:"call-intake",public_tool_call_id:"call-intake",run_id:canonical,project_id:scope.projectId}]:[],run:{run_id:scope.runId,conversation_id:input.threadId,latest_event_id:2,latest_external_event_sequence:1}});}

 if(body.method==="tools/call") { if(!body.params._meta?.tool_call_admission)throw new Error("Hidden integration call lacks its exact durable source admission"); if(body.params.arguments.project_reference!==scope.projectId||body.params._meta.run_id!==scope.runId)throw new Error("Wrong transport scope"); effects++; }
 return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="tools/list"?{tools:[{name:data.catalogName,description:"Fixture operation",inputSchema:{type:"object",properties:{project_reference:{type:"string"},path:{type:"string"},content:{type:"string"}}}}]}:{content:[{type:"text",text:"accepted"}]}}),{headers:{"content-type":"application/json"}});
},async()=>{
 writer=createProjectEventWriter({apiUrl:"https://8.8.8.8",runId:scope.runId,canonicalRunId:canonical,projectId:scope.projectId,threadId:input.threadId,token:"fixture-writer",latestEventId:0,latestExternalEventSequence:0});
 bindProjectEventWriter(input,writer);
 const agent=await withVeryfrontPlatformRemoteTools({agent:createAgentWithConfig(scope.agentId,{tools:{intake:wrapper},mcpServers:[{kind:"veryfront-api",toolPolicy:{allow:[]}}]}),token:"fixture-token",projectId:scope.projectId,programmaticPlatformRunId:scope.runId,programmaticPlatformToolNames:[data.operation],captureProgrammaticPlatformSource:source=>capturePlatformDependencySource(input,source)});
 if((Reflect.get(agent.config,"__vfAllowedRemoteTools")??[]).length) throw new Error("Dependency exposed to model");
 const response=await createRuntimeAgentStreamResponse(input,agent,{sessionManager:new AgentRunSessionManager(),createRuntime:()=>({stream:async()=>new ReadableStream({async pull(controller){const call={id:"call-intake"};const occurrence=introduceToolCallOccurrence(call);if(!occurrence)throw new Error("Pull lost tool occurrence scope");await writer.appendMappedEvent({event:"ToolCallStart",payload:{toolCallId:call.id,toolCallName:"intake"}},occurrence);await runWithToolCallOccurrenceDispatch(call,()=>executeConfiguredTool("intake",{},{intake:wrapper},scope,[],[]));controller.close();}},{highWaterMark:0})})});
 await response.text();
});
if(effects!==1)throw new Error("Expected exactly one platform effect");
let revoked=false;try{await runWithPlatformDependencyOwner(input,async()=>saved(data.operation,{}));}catch{revoked=true;}
if(!revoked||effects!==1)throw new Error("Settled stream retained authority");
console.log(JSON.stringify({effects,revoked,modelCalls:0}));
`;

for (const operation of ["veryfront__create_file", "outlook__get_email"]) {
  Deno.test(`operator proof reaches hidden ${operation} through actual runtime stream pulls`, async () => {
    const body = JSON.stringify({
      run: {
        runId: "run-1",
        agentId: "intake-agent",
        project: { projectId: "11111111-1111-4111-a111-111111111111" },
      },
      platformToolDependencies: [{ toolId: "intake", platformTools: [operation] }],
    });
    const signed = await createControlPlaneSignature(body, {
      projectId: "11111111-1111-4111-a111-111111111111",
    });
    const env: Record<string, string> = {
      DENO_TESTING: "0",
      NODE_ENV: "production",
      VERYFRONT_API_URL: "https://8.8.8.8",
      CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: signed.publicKeyPem,
    };
    for (const key of ["HOME", "DENO_DIR", "DENO_COVERAGE_DIR"]) {
      const value = Deno.env.get(key);
      if (value) env[key] = value;
    }
    // Eval does not emit Deno coverage. Run the identical production program
    // as a test module when the collector requests subprocess coverage.
    const coverageDir = Deno.env.get("DENO_COVERAGE_DIR");
    const modulePath = coverageDir ? await Deno.makeTempFile({ suffix: ".test.ts" }) : undefined;
    if (modulePath) await Deno.writeTextFile(modulePath, program);
    const child = new Deno.Command(Deno.execPath(), {
      args: modulePath
        ? [
          "test",
          "--no-check",
          "--allow-all",
          "--config",
          "deno.json",
          `--coverage=${coverageDir}`,
          "--coverage-raw-data-only",
          modulePath,
        ]
        : ["eval", "--config", "deno.json", program],
      clearEnv: true,
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify({
      body,
      ...signed,
      operation,
      catalogName: operation === "veryfront__create_file" ? "create_file" : operation,
      arguments: operation === "veryfront__create_file"
        ? { path: "qualification.txt", content: "fixture" }
        : { messageId: "fixture-message" },
    })));
    await writer.close();
    const output = await child.output().finally(async () => {
      if (modulePath) await Deno.remove(modulePath);
    });
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    assertEquals(
      JSON.parse(
        new TextDecoder().decode(output.stdout).trim().split("\n").findLast((line) =>
          line.startsWith('{"effects":')
        )!,
      ),
      {
        effects: 1,
        revoked: true,
        modelCalls: 0,
      },
    );
  });
}
