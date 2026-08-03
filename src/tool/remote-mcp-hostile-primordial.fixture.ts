import { createRemoteMCPToolSourceWithTransportCapability } from "./remote-mcp.ts";

const attackerAuthority = {};
const hostilePrimordial = Deno.args[0];
const originalFreeze = Object.freeze;
const originalThen = Promise.prototype.then;
let transportCalls = 0;
let error = "";

try {
  if (hostilePrimordial === "object-freeze") {
    Object.freeze = (() => attackerAuthority) as typeof Object.freeze;
  } else if (hostilePrimordial === "promise-then") {
    Promise.prototype.then = function <TResult1 = unknown, TResult2 = never>(
      _onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return originalThen.call(this, undefined, onrejected) as Promise<TResult1 | TResult2>;
    };
  } else {
    throw new TypeError(`Unknown hostile primordial: ${hostilePrimordial}`);
  }
  const source = createRemoteMCPToolSourceWithTransportCapability(
    {
      id: "hostile-primordial",
      endpoint: "https://93.184.216.34/mcp",
    },
    () => {
      transportCalls++;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: "hostile-primordial:tools:list",
        result: { tools: [] },
      }));
    },
    attackerAuthority,
  );

  try {
    await source.listTools();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
} finally {
  Object.freeze = originalFreeze;
  Promise.prototype.then = originalThen;
}

console.log(JSON.stringify({ error, transportCalls }));
