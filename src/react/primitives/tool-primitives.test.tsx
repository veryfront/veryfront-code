import "#veryfront/schemas/_test-setup.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ToolInvocation, ToolResult } from "./tool-primitives.tsx";

describe("react/primitives/tool-primitives", () => {
  it("renders hostile and non-JSON values through a bounded snapshot", () => {
    let getterCalled = false;
    const value: Record<string, unknown> = {
      bigint: 42n,
    };
    Object.defineProperty(value, "accessor", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("must not execute");
      },
    });
    value.self = value;

    const html = renderToStaticMarkup(
      <>
        <ToolInvocation name="search" input={value} />
        <ToolResult output={{ long: "x".repeat(70 * 1024) }} />
      </>,
    );

    assertEquals(getterCalled, false);
    assertStringIncludes(html, "&quot;bigint&quot;: &quot;42&quot;");
    assertStringIncludes(html, "[Accessor omitted]");
    assertStringIncludes(html, "[Circular]");
    assertStringIncludes(html, "[truncated]");
    assert(html.length < 70 * 1024, "tool rendering must remain bounded");
  });

  it("renders revoked proxies as unreadable instead of throwing", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    const html = renderToStaticMarkup(<ToolResult output={proxy} />);

    assertStringIncludes(html, "[Unreadable]");
  });

  it("does not leak control props or let callers replace structural markers", () => {
    const html = renderToStaticMarkup(
      <ToolInvocation
        name="lookup"
        output="private-result"
        {...{
          "data-tool-invocation": "spoofed",
          "data-tool-name": "spoofed",
        }}
      >
        <ToolResult
          output={{ ok: true }}
          {...{ "data-tool-result": "spoofed" }}
        />
      </ToolInvocation>,
    );

    assertEquals(/\soutput=/.test(html), false);
    assertEquals(html.includes("private-result"), false);
    assertStringIncludes(html, 'data-tool-invocation=""');
    assertStringIncludes(html, 'data-tool-name="lookup"');
    assertStringIncludes(html, 'data-tool-result=""');
    assertEquals(html.includes("spoofed"), false);
  });

  it("passes the original output to a custom renderer", () => {
    const output = { answer: 42 };
    let received: unknown;

    const html = renderToStaticMarkup(
      <ToolResult
        output={output}
        renderOutput={(value) => {
          received = value;
          return <span>custom</span>;
        }}
      />,
    );

    assert(received === output);
    assertStringIncludes(html, "<span>custom</span>");
  });
});
