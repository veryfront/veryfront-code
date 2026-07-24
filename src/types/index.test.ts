import "#veryfront/schemas/_test-setup.ts";
import type * as React from "react";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { HandlerPriority } from "./index.ts";
import type {
  AppProps,
  ClientComponentMeta,
  Component,
  ComponentFunction,
  ComponentProps,
  HandlerMetadata,
  LayoutItem,
  MDXComponents,
  MDXFrontmatter,
  RSCRendererOptions,
  ScriptPageModule,
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
const component: Component<{ slug: string }> = RequiredPage;
const componentFunction: ComponentFunction<{ slug: string }> = (_props) => null;
const defaultComponentFunction: ComponentFunction = (_props) => null;
const legacyComponentConsumer: (
  props: ComponentProps,
) => React.ReactElement | null = defaultComponentFunction;
const scriptPage: ScriptPageModule = {
  default: () => ({
    html: "<h1>Script page</h1>",
    frontmatter: { title: "Script page" },
  }),
};
const dataScriptPage: ScriptPageModule = {
  default: () => ({ message: "Data from script page" }),
};
const clientComponent: ClientComponentMeta = {
  id: "Counter",
  path: "/counter.js",
  exports: ["default"],
};
clientComponent.path = "/counter-v2.js";
clientComponent.exports.push("Counter");
const clientManifest = new Map([["Counter", clientComponent]]);
const rscOptions: RSCRendererOptions = {
  clientManifest,
  projectDir: "/project",
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
    assertEquals(typeof component, "function");
    assertEquals(componentFunction({ slug: "home" }), null);
    assertEquals(legacyComponentConsumer({}), null);
    assertEquals(typeof scriptPage.default, "function");
    assertEquals(typeof dataScriptPage.default, "function");
    assertEquals(rscOptions.clientManifest.get("Counter")?.path, "/counter-v2.js");
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
