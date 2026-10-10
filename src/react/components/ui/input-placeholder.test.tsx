import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Input } from "./input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx";
import { Textarea } from "./textarea.tsx";

describe("input placeholder semantics", () => {
  it("renders text fields against the semantic placeholder token", () => {
    const html = renderToString(
      <>
        <Input placeholder="Project name" />
        <Input icon={<span aria-hidden="true">#</span>} placeholder="With icon" />
        <Textarea placeholder="Describe the project" />
      </>,
    );

    assertEquals(
      html.match(/placeholder:text-\[var\(--input-placeholder\)\]/g)?.length,
      4,
      "plain input, icon input wrapper, icon input element and textarea use the token",
    );
    assert(
      !html.includes("placeholder:opacity-25"),
      "text inputs must not dim a readable placeholder token with opacity",
    );
    assert(
      !html.includes("placeholder:text-[var(--foreground)]"),
      "text inputs must not synthesize placeholder color from foreground opacity",
    );
  });

  it("renders SelectValue placeholders with the same semantic token", () => {
    const html = renderToString(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    );

    assertStringIncludes(html, "data-placeholder");
    assertStringIncludes(html, "text-[var(--input-placeholder)]");
    assert(
      !html.includes("opacity-25"),
      "select placeholders must not dim the readable placeholder token",
    );
  });
});
