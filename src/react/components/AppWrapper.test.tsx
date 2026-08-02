import { renderToString } from "react-dom/server";
import { assertEquals, assertInstanceOf, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AppWrapper, MdxWrapperRenderError } from "./AppWrapper.tsx";

const bundle = {
  compiledCode: "export default function Wrapper() {}",
};

function captureWrapperError(render: () => string): MdxWrapperRenderError {
  let error: unknown;
  try {
    render();
  } catch (cause) {
    error = cause;
  }
  assertInstanceOf(error, MdxWrapperRenderError);
  return error;
}

describe("AppWrapper", () => {
  it("passes children through when no compiled wrapper is configured", () => {
    assertEquals(
      renderToString(
        <AppWrapper>
          <main>content</main>
        </AppWrapper>,
      ),
      "<main>content</main>",
    );
  });

  it("fails closed with an actionable typed error for compiled layouts", () => {
    const error = captureWrapperError(() =>
      renderToString(
        <AppWrapper layout={bundle}>
          <main>content</main>
        </AppWrapper>,
      )
    );
    assertStringIncludes(error.message, "mdxRenderer.loadModuleESM");
    assertEquals(error.code, "VF_REACT_ASYNC_MDX_REQUIRED");
    assertEquals(error.wrapperKind, "layout");
  });

  it("fails closed instead of bypassing a compiled provider", () => {
    const error = captureWrapperError(() =>
      renderToString(
        <AppWrapper providers={[bundle]}>
          <main>content</main>
        </AppWrapper>,
      )
    );
    assertStringIncludes(error.message, "MDXWrapper or default");
    assertEquals(error.wrapperKind, "provider");
  });
});
