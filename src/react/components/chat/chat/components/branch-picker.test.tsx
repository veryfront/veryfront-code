import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BranchPicker } from "./branch-picker.tsx";

describe("BranchPicker", () => {
  it("renders the default previous, count, and next controls", () => {
    const html = renderToString(
      <BranchPicker current={2} total={3} onPrev={() => {}} onNext={() => {}} />,
    );

    assertStringIncludes(html, "Previous variant");
    assertStringIncludes(html, "2/3");
    assertStringIncludes(html, "Next variant");
  });

  it("renders nothing when there is only one branch", () => {
    const html = renderToString(
      <BranchPicker current={1} total={1} onPrev={() => {}} onNext={() => {}} />,
    );
    assertEquals(html, "");
  });

  it("composes and restyles addressable icon leaves", () => {
    const html = renderToString(
      <BranchPicker current={2} total={3} onPrev={() => {}} onNext={() => {}}>
        <BranchPicker.Next
          icon={<span data-testid="custom-next">next</span>}
          className="vf-next"
        />
        <BranchPicker.Count className="vf-count" />
        <BranchPicker.Previous
          icon={<span data-testid="custom-previous">previous</span>}
          className="vf-previous"
        />
      </BranchPicker>,
    );

    assertStringIncludes(html, "custom-next");
    assertStringIncludes(html, "vf-next");
    assertStringIncludes(html, "vf-count");
    assertStringIncludes(html, "custom-previous");
    assertStringIncludes(html, "vf-previous");
  });

  it("exposes every compound leaf", () => {
    for (const part of ["Root", "Previous", "Count", "Next"]) {
      assertEquals(
        typeof (BranchPicker as unknown as Record<string, unknown>)[part],
        "function",
      );
    }
  });
});
