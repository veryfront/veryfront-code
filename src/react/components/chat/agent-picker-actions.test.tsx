import type * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { AgentPickerCreate, AgentPickerManage } from "./agent-picker-actions.tsx";
import { AgentPickerContext } from "./agent-picker-context.tsx";
import { Command, CommandList } from "../ui/command.tsx";
import { PlusIcon, SparklesIcon } from "../ui/icons/index.ts";

function renderWithPicker(
  value: { onCreate?: () => void; onManage?: () => void },
  children: React.ReactNode,
) {
  return renderToString(
    <AgentPickerContext.Provider
      value={{
        value: undefined,
        onSelect: () => undefined,
        open: true,
        setOpen: () => undefined,
        ...value,
      }}
    >
      <Command>
        <CommandList>{children}</CommandList>
      </Command>
    </AgentPickerContext.Provider>,
  );
}

describe("AgentPickerCreate", () => {
  it("renders nothing when onCreate is absent", () => {
    const html = renderWithPicker({}, <AgentPickerCreate />);
    assert(!html.includes("Create Agent"));
  });

  it("renders the default label and icon when onCreate is present", () => {
    const html = renderWithPicker({ onCreate: () => undefined }, <AgentPickerCreate />);
    assertStringIncludes(html, "Create Agent");
    assertStringIncludes(html, renderToString(<PlusIcon />), "default Plus glyph renders");
  });

  it("renders a custom icon in place of the default Plus glyph", () => {
    const html = renderWithPicker(
      { onCreate: () => undefined },
      <AgentPickerCreate icon={<span data-testid="custom-icon" />} />,
    );
    assertStringIncludes(html, 'data-testid="custom-icon"', "custom icon renders");
    assert(
      !html.includes(renderToString(<PlusIcon />)),
      "default Plus glyph must not render alongside a custom icon",
    );
  });

  it("renders custom children and className when supplied", () => {
    const html = renderWithPicker(
      { onCreate: () => undefined },
      <AgentPickerCreate className="vf-custom-create">New Agent</AgentPickerCreate>,
    );
    assertStringIncludes(html, "New Agent");
    assertStringIncludes(html, "vf-custom-create");
    assert(!html.includes(">Create Agent<"));
  });
});

describe("AgentPickerManage", () => {
  it("renders nothing when onManage is absent", () => {
    const html = renderWithPicker({}, <AgentPickerManage />);
    assert(!html.includes("Manage Agents"));
  });

  it("renders the default label and icon when onManage is present", () => {
    const html = renderWithPicker({ onManage: () => undefined }, <AgentPickerManage />);
    assertStringIncludes(html, "Manage Agents");
    assertStringIncludes(
      html,
      renderToString(<SparklesIcon />),
      "default Sparkles glyph renders",
    );
  });

  it("renders a custom icon in place of the default Sparkles glyph", () => {
    const html = renderWithPicker(
      { onManage: () => undefined },
      <AgentPickerManage icon={<span data-testid="custom-icon" />} />,
    );
    assertStringIncludes(html, 'data-testid="custom-icon"', "custom icon renders");
    assert(
      !html.includes(renderToString(<SparklesIcon />)),
      "default Sparkles glyph must not render alongside a custom icon",
    );
  });
});
