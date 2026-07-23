import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ReactNode } from "react";
import type { HandlerMetadata, LayoutItem, MDXComponents, MDXFrontmatter } from "./index.ts";

const Heading = (_props: { children?: ReactNode }) => null;
const components: MDXComponents = { h1: Heading };
const layout: LayoutItem = { kind: "tsx", component: Heading };
const metadata: HandlerMetadata = { name: "CustomPriority", priority: 600 };
const frontmatter: MDXFrontmatter = {
  tags: "release",
  date: new Date("2026-07-18T00:00:00.000Z"),
  author: { name: "Ada" },
  weights: [1, 2],
  missing: null,
};

// @ts-expect-error Layout components must be renderable React components.
const invalidLayout: LayoutItem = { kind: "tsx", component: 42 };
void invalidLayout;

describe("types public contracts", () => {
  it("accepts ordinary React components and numeric handler priorities", () => {
    assertEquals(typeof components.h1, "function");
    assertEquals(typeof layout.component, "function");
    assertEquals(metadata.priority, 600);
    assertEquals(frontmatter.author, { name: "Ada" });
  });
});
