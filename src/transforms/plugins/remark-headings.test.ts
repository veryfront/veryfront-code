import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { VFile } from "vfile";
import { remarkMdxHeadings } from "./remark-headings.ts";
import type { Heading, Root } from "mdast";

interface HeadingEntry {
  text: string;
  id: string;
  level: number;
}

function isHeadingEntry(value: unknown): value is HeadingEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("text" in value) || !("id" in value) || !("level" in value)) return false;
  return (
    typeof value.text === "string" &&
    typeof value.id === "string" &&
    typeof value.level === "number"
  );
}

function expectHeadings(file: VFile): HeadingEntry[] {
  const headings = file.data.headings;
  assert(Array.isArray(headings), "headings should be an array");
  assert(headings.every(isHeadingEntry), "all headings should be HeadingEntry");
  return headings;
}

function createHeading(depth: number, text: string): Heading {
  return {
    type: "heading",
    depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
    children: [{ type: "text", value: text }],
  };
}

function createTree(...headings: Heading[]): Root {
  return {
    type: "root",
    children: headings,
  };
}

describe("remark-headings", () => {
  it("extracts single heading", () => {
    const tree = createTree(createHeading(1, "Hello World"));
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    assertEquals(headings.length, 1);
    const first = headings[0];
    assertExists(first);
    assertEquals(first.text, "Hello World");
    assertEquals(first.id, "hello-world");
    assertEquals(first.level, 1);
  });

  it("extracts multiple headings", () => {
    const tree = createTree(
      createHeading(1, "First Heading"),
      createHeading(2, "Second Heading"),
      createHeading(3, "Third Heading"),
    );
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    assertEquals(headings.length, 3);
    const first = headings[0];
    const second = headings[1];
    const third = headings[2];
    assertExists(first);
    assertExists(second);
    assertExists(third);
    assertEquals(first.text, "First Heading");
    assertEquals(second.text, "Second Heading");
    assertEquals(third.text, "Third Heading");
  });

  it("generates correct slugs", () => {
    const tree = createTree(
      createHeading(1, "This is a Test"),
      createHeading(2, "Special @#$ Characters!"),
      createHeading(3, "Numbers 123 456"),
    );
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    const first = headings[0];
    const second = headings[1];
    const third = headings[2];
    assertExists(first);
    assertExists(second);
    assertExists(third);
    assertEquals(first.id, "this-is-a-test");
    assertEquals(second.id, "special--characters");
    assertEquals(third.id, "numbers-123-456");
  });

  it("handles duplicate headings", () => {
    const tree = createTree(
      createHeading(1, "Same Heading"),
      createHeading(2, "Same Heading"),
      createHeading(3, "Same Heading"),
    );
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    const first = headings[0];
    const second = headings[1];
    const third = headings[2];
    assertExists(first);
    assertExists(second);
    assertExists(third);
    assertEquals(first.id, "same-heading");
    assertEquals(second.id, "same-heading-1");
    assertEquals(third.id, "same-heading-2");
  });

  it("handles empty content", () => {
    const tree: Root = {
      type: "root",
      children: [],
    };
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    assertEquals(headings.length, 0);
  });

  it("adds ID to heading data", () => {
    type HeadingData = { hProperties?: { id?: string } };
    const heading = createHeading(1, "Test Heading");
    const tree = createTree(heading);
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    assertExists(heading.data);
    assertExists((heading.data as HeadingData).hProperties);
    assertEquals((heading.data as HeadingData).hProperties?.id, "test-heading");
  });

  it("preserves heading levels", () => {
    const tree = createTree(
      createHeading(1, "H1"),
      createHeading(2, "H2"),
      createHeading(3, "H3"),
      createHeading(4, "H4"),
      createHeading(5, "H5"),
      createHeading(6, "H6"),
    );
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    for (let i = 0; i < headings.length; i++) {
      const headingEntry = headings[i];
      assertExists(headingEntry);
      assertEquals(headingEntry.level, i + 1);
    }
  });

  it("exports headings as MDX variable", () => {
    type MdxNode = { type: string };
    const tree = createTree(createHeading(1, "Export Test"));
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    assertEquals(tree.children.length, 2); // original heading + export
    assertEquals((tree.children[0] as MdxNode).type, "mdxjsEsm");
  });

  it("creates valid estree export", () => {
    type MdxExportNode = {
      data?: {
        estree?: {
          type: string;
          body: Array<{ type: string }>;
        };
      };
    };
    const tree = createTree(createHeading(1, "Estree Test"));
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const exportNode = tree.children[0] as MdxExportNode;
    assertExists(exportNode.data);
    assertExists(exportNode.data.estree);
    assertEquals(exportNode.data.estree?.type, "Program");
    const body = exportNode.data.estree?.body;
    assertExists(body);
    const firstStatement = body[0];
    assertExists(firstStatement);
    assertEquals(firstStatement.type, "ExportNamedDeclaration");
  });

  it("handles headings with complex text", () => {
    const heading: Heading = {
      type: "heading",
      depth: 1,
      children: [
        { type: "text", value: "Hello " },
        { type: "strong", children: [{ type: "text", value: "Bold" }] },
        { type: "text", value: " World" },
      ],
    };
    const tree = createTree(heading);
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    const first = headings[0];
    assertExists(first);
    assertEquals(first.text, "Hello Bold World");
    assertEquals(first.id, "hello-bold-world");
  });

  it("initializes file data if missing", () => {
    const tree = createTree(createHeading(1, "Data Init Test"));
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    assertExists(file.data);
    const headings = file.data.headings;
    assert(Array.isArray(headings));
  });

  it("handles nested content in headings", () => {
    const heading: Heading = {
      type: "heading",
      depth: 2,
      children: [
        { type: "text", value: "Text with " },
        { type: "emphasis", children: [{ type: "text", value: "italic" }] },
        { type: "text", value: " and " },
        { type: "inlineCode", value: "code" },
      ],
    };
    const tree = createTree(heading);
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    const first = headings[0];
    assertExists(first);
    assertEquals(first.text, "Text with italic and code");
    assertExists(first.id);
  });

  it("resets slugger between runs", () => {
    const tree1 = createTree(createHeading(1, "Same"));
    const file1 = new VFile();

    const plugin1 = remarkMdxHeadings();
    plugin1(tree1, file1);

    const tree2 = createTree(createHeading(1, "Same"));
    const file2 = new VFile();

    const plugin2 = remarkMdxHeadings();
    plugin2(tree2, file2);

    const headings1 = expectHeadings(file1);
    const headings2 = expectHeadings(file2);
    const first1 = headings1[0];
    const first2 = headings2[0];
    assertExists(first1);
    assertExists(first2);
    assertEquals(first1.id, "same");
    assertEquals(first2.id, "same");
  });

  it("handles unicode characters", () => {
    const tree = createTree(
      createHeading(1, "Hello 世界"),
      createHeading(2, "Привет мир"),
      createHeading(3, "مرحبا بالعالم"),
    );
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    const headings = expectHeadings(file);
    const first = headings[0];
    const second = headings[1];
    const third = headings[2];
    assertExists(first);
    assertExists(second);
    assertExists(third);
    assertExists(first.id);
    assertExists(second.id);
    assertExists(third.id);
  });

  it("preserves existing heading data", () => {
    type CustomHeadingData = { customProp?: string; hProperties?: { id?: string } };
    const heading = createHeading(1, "Existing Data");
    (heading as unknown as { data: CustomHeadingData }).data = {
      customProp: "value",
    };
    const tree = createTree(heading);
    const file = new VFile();

    const plugin = remarkMdxHeadings();
    plugin(tree, file);

    assertEquals((heading.data as CustomHeadingData).customProp, "value");
    assertExists((heading.data as CustomHeadingData).hProperties);
  });
});
