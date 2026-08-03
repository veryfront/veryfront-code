import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { AgentPickerContext, useAgentPicker } from "./agent-picker-context.tsx";

describe("useAgentPicker", () => {
  it("returns the provided context value inside a provider", () => {
    function Probe() {
      const { value, open } = useAgentPicker();
      return (
        <div data-value={value} data-open={open}>
          probe
        </div>
      );
    }
    const html = renderToString(
      <AgentPickerContext.Provider
        value={{
          value: "agent-1",
          onSelect: () => undefined,
          open: true,
          setOpen: () => undefined,
        }}
      >
        <Probe />
      </AgentPickerContext.Provider>,
    );
    assertStringIncludes(html, 'data-value="agent-1"');
    assertStringIncludes(html, 'data-open="true"');
  });

  it("fails fast when used outside an AgentPickerContext provider", () => {
    function Orphan() {
      useAgentPicker();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useAgentPicker is a loud error, not silent");
  });

  it("exposes onCreate/onManage as undefined when not supplied", () => {
    function Probe() {
      const { onCreate, onManage } = useAgentPicker();
      return <div data-has-create={String(!!onCreate)} data-has-manage={String(!!onManage)} />;
    }
    const html = renderToString(
      <AgentPickerContext.Provider
        value={{
          value: undefined,
          onSelect: () => undefined,
          open: false,
          setOpen: () => undefined,
        }}
      >
        <Probe />
      </AgentPickerContext.Provider>,
    );
    assertStringIncludes(html, 'data-has-create="false"');
    assertStringIncludes(html, 'data-has-manage="false"');
  });

  it("is a React context object", () => {
    assertEquals(typeof AgentPickerContext, "object");
  });
});
