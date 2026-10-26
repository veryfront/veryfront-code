import { assertEquals } from "#veryfront/testing/assert.ts";

Deno.test("HTTP-only Deno listeners require network permission without env or read grants", async () => {
  const runtime =
    new URL("../../../src/platform/adapters/runtime/deno/http-server.ts", import.meta.url).href;
  const compatibility =
    new URL("../../../src/platform/compat/http/deno-server.ts", import.meta.url).href;
  const service = new URL("../../../src/server/service-server.ts", import.meta.url).href;
  const source = `
import { createDenoServer } from ${JSON.stringify(runtime)};
import { DenoHttpServer } from ${JSON.stringify(compatibility)};
import { createVeryfrontServer, startVeryfrontServer } from ${JSON.stringify(service)};
const handler = () => new Response("ok");
const options = {hostname:"127.0.0.1",port:0};
const listener = await createDenoServer(handler, options);
try { if(await (await fetch("http://127.0.0.1:"+listener.addr.port)).text()!=="ok")throw Error("runtime"); }
finally { await listener.stop(); }
const compat = new DenoHttpServer();
const ready = Promise.withResolvers();
const serving = compat.serve(handler,{...options,onListen:ready.resolve});
try { const address=await ready.promise; if(await (await fetch("http://127.0.0.1:"+address.port)).text()!=="ok")throw Error("compat"); }
finally {await compat.close();await serving;}
const server = await startVeryfrontServer({runtime:createVeryfrontServer({modules:[{name:"http",handle:handler}]}),port:0,bindAddress:"127.0.0.1",signals:[],logger:{}});
try {if(await(await fetch(server.url)).text()!=="ok")throw Error("service");}finally{await server.stop();}
`;
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--config=deno.json", "--allow-net=127.0.0.1", "--no-prompt", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(source));
  await writer.close();
  const output = await child.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
});
