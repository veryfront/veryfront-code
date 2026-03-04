import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectNodePositions } from "./babel-node-positions.ts";

describe("babel-node-positions", () => {
  describe("injectNodePositions", () => {
    it("injects data-node-* attributes on JSX elements", () => {
      const source = `export default function Page() {
  return <div>Hello</div>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-file="app/page.tsx"'), true);
      assertEquals(result.includes('data-node-name="div"'), true);
      assertEquals(result.includes("data-node-line="), true);
      assertEquals(result.includes("data-node-column="), true);
    });

    it("injects on custom components", () => {
      const source = `import { Button } from "./button";
export default function Page() {
  return <Button>Click</Button>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="Button"'), true);
      assertEquals(result.includes('data-node-file="app/page.tsx"'), true);
    });

    it("handles member expressions like Foo.Bar", () => {
      const source = `export default function Page() {
  return <Icons.Arrow />;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="Icons.Arrow"'), true);
    });

    it("skips SVG elements", () => {
      const source = `export default function Icon() {
  return <svg><path d="M0 0" /><circle r="5" /></svg>;
}`;
      const result = injectNodePositions(source, { filePath: "app/icon.tsx" });

      assertEquals(result.includes('data-node-name="svg"'), false);
      assertEquals(result.includes('data-node-name="path"'), false);
      assertEquals(result.includes('data-node-name="circle"'), false);
    });

    it("skips Fragment elements", () => {
      const source = `export default function Page() {
  return <Fragment><div>A</div></Fragment>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="Fragment"'), false);
      assertEquals(result.includes('data-node-name="div"'), true);
    });

    it("skips React.Fragment", () => {
      const source = `export default function Page() {
  return <React.Fragment><p>Hi</p></React.Fragment>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="React.Fragment"'), false);
      assertEquals(result.includes('data-node-name="p"'), true);
    });

    it("skips elements that already have data-node-line", () => {
      const source = `export default function Page() {
  return <div data-node-line="5">Hello</div>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      // Should not add a second data-node-line
      const matches = result.match(/data-node-line/g);
      assertEquals(matches?.length, 1);
    });

    it("skips elements that already have data-vf-id", () => {
      const source = `export default function Page() {
  return <div data-vf-id="abc">Hello</div>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="div"'), false);
    });

    it("skips head/meta/script elements", () => {
      const source = `export default function Layout() {
  return <html><head><meta charSet="utf-8" /><title>Hi</title></head><body><div>content</div></body></html>;
}`;
      const result = injectNodePositions(source, { filePath: "app/layout.tsx" });

      assertEquals(result.includes('data-node-name="html"'), false);
      assertEquals(result.includes('data-node-name="head"'), false);
      assertEquals(result.includes('data-node-name="meta"'), false);
      assertEquals(result.includes('data-node-name="title"'), false);
      assertEquals(result.includes('data-node-name="body"'), false);
      assertEquals(result.includes('data-node-name="div"'), true);
    });

    it("returns source unchanged for empty input", () => {
      const result = injectNodePositions("", { filePath: "app/page.tsx" });
      assertEquals(result, "");
    });

    it("returns source unchanged for whitespace-only input", () => {
      const source = "   \n  \n  ";
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });
      assertEquals(result, source);
    });

    it("returns source unchanged when filePath is empty", () => {
      const source = `export default function Page() {
  return <div>Hello</div>;
}`;
      const result = injectNodePositions(source, { filePath: "" });
      assertEquals(result, source);
    });

    it("handles nested elements", () => {
      const source = `export default function Page() {
  return <section><div><span>text</span></div></section>;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="section"'), true);
      assertEquals(result.includes('data-node-name="div"'), true);
      assertEquals(result.includes('data-node-name="span"'), true);
    });

    it("handles self-closing elements", () => {
      const source = `export default function Page() {
  return <img src="/photo.jpg" />;
}`;
      const result = injectNodePositions(source, { filePath: "app/page.tsx" });

      assertEquals(result.includes('data-node-name="img"'), true);
    });

    it("returns source unchanged for non-JSX code", () => {
      const source = `export const x = 1 + 2;`;
      const result = injectNodePositions(source, { filePath: "utils.ts" });

      assertEquals(result.includes("data-node"), false);
    });

    it("returns source unchanged for invalid syntax", () => {
      const source = `export default function { <broken`;
      const result = injectNodePositions(source, { filePath: "broken.tsx" });

      assertEquals(result, source);
    });
  });
});
