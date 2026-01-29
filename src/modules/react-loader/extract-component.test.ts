import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractComponent } from "./extract-component.ts";

describe("modules/react-loader/extract-component", () => {
  describe("extractComponent", () => {
    it("should extract default export", () => {
      const MyComponent = () => null;
      const mod = { default: MyComponent };
      assertEquals(extractComponent(mod, "test.tsx"), MyComponent);
    });

    it("should fallback to first named export if no default", () => {
      const Named = () => null;
      const mod = { Named };
      assertEquals(extractComponent(mod, "test.tsx"), Named);
    });

    it("should prefer default over named exports", () => {
      const Default = () => null;
      const Named = () => null;
      const mod = { default: Default, Named };
      assertEquals(extractComponent(mod, "test.tsx"), Default);
    });

    it("should throw when module has no exports", () => {
      assertThrows(
        () => extractComponent({}, "empty.tsx"),
        Error,
        "No component exported from empty.tsx",
      );
    });
  });
});
