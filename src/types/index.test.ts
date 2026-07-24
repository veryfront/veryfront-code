import "#veryfront/schemas/_test-setup.ts";
import type * as React from "react";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { HandlerPriority } from "./index.ts";
import type {
  AppProps,
  HandlerMetadata,
  LayoutItem,
  MDXComponents,
  MDXFrontmatter,
} from "./index.ts";

const Heading = (_props: { level: 1 | 2 }) => null;
const Layout = () => null;
const RequiredLayout = (_props: { children: React.ReactNode; theme: string }) => null;
const RequiredPage = (_props: { slug: string }) => null;
const components: MDXComponents = { h1: Heading };
const layout: LayoutItem = { kind: "tsx", component: Layout };
const requiredLayout: LayoutItem = { kind: "tsx", component: RequiredLayout };
const app: AppProps<{ slug: string }> = {
  Component: RequiredPage,
  pageProps: { slug: "home" },
};
const metadata: HandlerMetadata = {
  name: "MediumPriority",
  priority: HandlerPriority.MEDIUM,
};
const customPriorityMetadata: HandlerMetadata = {
  name: "CustomPriority",
  priority: 5,
};
const frontmatter: MDXFrontmatter = {
  tags: "release",
  date: new Date("2026-07-18T00:00:00.000Z"),
  author: "Ada",
  weights: ["1", "2"],
  metadata: {
    owner: "platform",
    flags: [true, null, { stable: true }],
  },
};

describe("types public contracts", () => {
  it("preserves component, handler, and frontmatter contracts", () => {
    assertEquals(typeof components.h1, "function");
    assertEquals(typeof layout.component, "function");
    assertEquals(typeof requiredLayout.component, "function");
    assertEquals(app.pageProps.slug, "home");
    assertEquals(metadata.priority, HandlerPriority.MEDIUM);
    assertEquals(customPriorityMetadata.priority, 5);
    assertEquals(frontmatter.author, "Ada");
    assertEquals(frontmatter.tags, "release");
    assertEquals(frontmatter.date instanceof Date, true);
    assertEquals(frontmatter.metadata, {
      owner: "platform",
      flags: [true, null, { stable: true }],
    });
  });
});
