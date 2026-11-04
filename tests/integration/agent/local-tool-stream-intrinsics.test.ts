import { createLocalToolStream } from "#veryfront/agent/ag-ui/local-tool-stream.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

const start = { type: "TOOL_CALL_START", toolCallId: "call", toolCallName: "search" };
const args = { type: "TOOL_CALL_ARGS", toolCallId: "call", delta: "{}" };
const end = { type: "TOOL_CALL_END", toolCallId: "call" };

it("keeps local tool admission ordering when project code replaces mutable intrinsics", () => {
  const stream = createLocalToolStream();
  const startsWith = String.prototype.startsWith;
  const has = Set.prototype.has;
  const add = Set.prototype.add;
  const push = Array.prototype.push;
  const splice = Array.prototype.splice;
  let before: typeof start[] = [];
  let admitted: typeof start[] = [];
  let finished: typeof start[] = [];
  try {
    String.prototype.startsWith = () => false;
    Set.prototype.has = () => true;
    Set.prototype.add = function () {
      return this;
    };
    Array.prototype.push = function () {
      return this.length;
    };
    Array.prototype.splice = function () {
      return [];
    };
    before = stream.encode([start, args, end]) as typeof start[];
    admitted = stream.admit("call") as typeof start[];
    finished = stream.finish() as typeof start[];
  } finally {
    String.prototype.startsWith = startsWith;
    Set.prototype.has = has;
    Set.prototype.add = add;
    Array.prototype.push = push;
    Array.prototype.splice = splice;
  }
  assertEquals(before, []);
  assertEquals(admitted, [args, end]);
  assertEquals(finished, []);
});
