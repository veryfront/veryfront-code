import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractComponent } from "./extract-component.ts";

describe("modules/react-loader/extract-component", () => {
  it("should extract default export", () => {
    const MyComponent = () => null;
    assertEquals(extractComponent({ default: MyComponent }, "test.tsx"), MyComponent);
  });

  it("should fallback to first named export if no default", () => {
    const Named = () => null;
    assertEquals(extractComponent({ Named }, "test.tsx"), Named);
  });

  it("should prefer default over named exports", () => {
    const Default = () => null;
    const Named = () => null;
    assertEquals(extractComponent({ default: Default, Named }, "test.tsx"), Default);
  });

  it("should throw when module has no exports", () => {
    assertThrows(
      () => extractComponent({}, "empty.tsx"),
      Error,
      "No component exported from empty.tsx",
    );
  });
});
