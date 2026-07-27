import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { assertReactComponentType } from "./react-component-type.ts";

describe("rendering/react-component-type", () => {
  it("accepts function and exotic React component types", () => {
    function FunctionComponent() {
      return null;
    }
    const MemoComponent = React.memo(FunctionComponent);

    assertEquals(
      assertReactComponentType(FunctionComponent, "function module"),
      FunctionComponent,
    );
    assertEquals(
      assertReactComponentType(MemoComponent, "memo module"),
      MemoComponent,
    );
  });

  it("rejects invalid exports without reading an accessor value", () => {
    let accessorReads = 0;
    const invalid = Object.defineProperty({}, "$$typeof", {
      get() {
        accessorReads++;
        return Symbol.for("react.memo");
      },
    });

    assertThrows(
      () => assertReactComponentType(invalid, "invalid module"),
      TypeError,
      "invalid module did not export a React component",
    );
    assertEquals(accessorReads, 0);
  });
});
