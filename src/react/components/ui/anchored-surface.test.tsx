import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Popover, PopoverTrigger } from "./popover.tsx";
import { DropdownMenu, DropdownMenuTrigger } from "./dropdown-menu.tsx";

describe("anchored surfaces anchor to the trigger ref", () => {
  it("Popover root renders no wrapper node", () => {
    const html = renderToString(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
      </Popover>,
    );

    // The trigger button is the outermost markup - no anchor <span> wrapper.
    assert(
      html.startsWith("<button"),
      `expected trigger-first markup, got: ${html.slice(0, 60)}`,
    );
    assertEquals(html.includes("relative inline-block"), false);
    assertStringIncludes(html, 'aria-haspopup="dialog"');
  });

  it("DropdownMenu root renders no wrapper node", () => {
    const html = renderToString(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      </DropdownMenu>,
    );

    assert(
      html.startsWith("<button"),
      `expected trigger-first markup, got: ${html.slice(0, 60)}`,
    );
    assertEquals(html.includes("relative inline-block"), false);
    assertStringIncludes(html, 'aria-haspopup="menu"');
  });

  it("asChild trigger keeps the child as the outermost node", () => {
    const html = renderToString(
      <Popover>
        <PopoverTrigger asChild>
          <a href="#open">Open</a>
        </PopoverTrigger>
      </Popover>,
    );

    assert(
      html.startsWith("<a "),
      `expected the slotted child as outermost markup, got: ${html.slice(0, 60)}`,
    );
    assertStringIncludes(html, 'aria-haspopup="dialog"');
  });
});
