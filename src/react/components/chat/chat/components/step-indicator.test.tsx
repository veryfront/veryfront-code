import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { StepIndicator, useStepIndicator } from "./step-indicator.tsx";

describe("StepIndicator", () => {
  it("renders the default anatomy (rules + label)", () => {
    const html = renderToString(<StepIndicator stepIndex={0} isComplete />);
    // React SSR splits "Step {n}" into two text nodes, so match the label text
    // and the rendered index separately.
    assertStringIncludes(html, "Step");
    assertStringIncludes(html, ">1<");
    assertStringIncludes(html, "flex-1 h-px bg-[var(--edge)]");
  });

  it("labels the step from the zero-based index", () => {
    const html = renderToString(
      <StepIndicator stepIndex={2} isComplete={false} />,
    );
    assertStringIncludes(html, ">3<");
  });
});

// The composability contract: a consuming developer must be able to recompose
// the divider, and restyle a part. If these fail, `StepIndicator` is not
// composable — these tests ARE the definition.
describe("StepIndicator — composability contract", () => {
  it("recomposes: a caller can render a single-rule variant", () => {
    const html = renderToString(
      <StepIndicator stepIndex={0} isComplete>
        <StepIndicator.Label />
        <StepIndicator.Rule />
      </StepIndicator>,
    );
    // Custom order: the label pill renders before the (single) rule.
    assert(
      html.indexOf("rounded-full border") < html.indexOf("flex-1 h-px"),
      "expected the Label to render before the Rule in the recomposed divider",
    );
    // Exactly one rule in this variant (default anatomy renders two).
    assertEquals(html.split("flex-1 h-px").length - 1, 1);
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <StepIndicator stepIndex={0} isComplete>
        <StepIndicator.Label className="vf-custom-label-class" />
      </StepIndicator>,
    );
    assertStringIncludes(html, "vf-custom-label-class");
  });

  it("useStepIndicator throws outside a StepIndicator", () => {
    function Orphan() {
      useStepIndicator();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
