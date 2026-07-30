import { renderToString } from "react-dom/server";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AppWrapper, MdxWrapperRenderError } from "./AppWrapper.tsx";

const bundle = {
  compiledCode: "export default function Wrapper() {}",
};

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
    const error = assertThrows(
      () =>
        renderToString(
          <AppWrapper layout={bundle}>
            <main>content</main>
          </AppWrapper>,
        ),
      MdxWrapperRenderError,
      "mdxRenderer.loadModuleESM",
    );
    assertEquals(error.code, "VF_REACT_ASYNC_MDX_REQUIRED");
    assertEquals(error.wrapperKind, "layout");
  });

  it("fails closed instead of bypassing a compiled provider", () => {
    const error = assertThrows(
      () =>
        renderToString(
          <AppWrapper providers={[bundle]}>
            <main>content</main>
          </AppWrapper>,
        ),
      MdxWrapperRenderError,
      "MDXWrapper or default",
    );
    assertEquals(error.wrapperKind, "provider");
  });
});
