import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { parseAgUiSseResponse } from "../../../../../../src/agent/ag-ui/sse-parser.ts";

const testReflectApply = Reflect.apply;
const nativeMapGet = Map.prototype.get;
const nativeFunctionCall = Function.prototype.call;
type Callable = (...args: unknown[]) => unknown;

describe("agent/ag-ui SSE parser intrinsic boundaries", () => {
  afterEach(() => {
    Map.prototype.get = nativeMapGet;
    Function.prototype.call = nativeFunctionCall;
  });

  it("normalizes native citation wire names after project code replaces map and call hooks", async () => {
    let poisonedMapCalls = 0;
    let poisonedCallCalls = 0;
    Map.prototype.get = function () {
      poisonedMapCalls += 1;
      throw new Error("project Map.prototype.get hook");
    };
    Function.prototype.call = function (this: Callable, thisArg: unknown, ...args: unknown[]) {
      if (this === nativeMapGet) {
        poisonedCallCalls += 1;
        throw new Error("project Function.prototype.call hook");
      }
      return testReflectApply(nativeFunctionCall, this, [thisArg, ...args]);
    };

    const response = new Response(
      'event: UrlCited\ndata: {"sourceId":"web-1","url":"https://example.com/reference"}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const run = await parseAgUiSseResponse(response);
    Map.prototype.get = nativeMapGet;
    Function.prototype.call = nativeFunctionCall;

    assertEquals(poisonedMapCalls, 0);
    assertEquals(poisonedCallCalls, 0);
    assertEquals(run.eventTypes, ["URL_CITED"]);
    assertEquals(run.events[0]?.type, "URL_CITED");
    assertEquals(run.events[0]?.sourceId, "web-1");
  });
});
