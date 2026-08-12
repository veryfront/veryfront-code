/**
 * `veryfront/ui` SHARED CONFORMANCE HARNESS.
 *
 * A single characterization suite that renders every shipped, standalone
 * `veryfront/ui` component and proves the RFC 2980 composition rules where they
 * apply. Two tiers:
 *
 *   - **Leaves** (single DOM node): assert one root node, `ref` forwarded to it,
 *     arbitrary `{...props}` (`data-*`) spread through, and `className` merged
 *     (consumer wins, base classes kept).
 *   - **Smoke** (compounds / context-driven): assert the component renders at
 *     least one node without throwing, in a minimal valid composition.
 *
 * This is the "shared conformance/characterization suite" the coverage manifest
 * (`coverage.test.tsx`) credits for the "has a test" gate — every enumerated
 * component name is referenced here. Adapter-routed overlays (Popover, Dialog,
 * DropdownMenu, Tooltip, Select) have their own `adapter/*.conformance.test.tsx`.
 *
 * @module react/components/ui/conformance.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { Button, LoadingButton } from "./button.tsx";
import { IconButton } from "./icon-button.tsx";
import { Card, CardContent, CardHeader } from "./card.tsx";
import { Badge } from "./badge.tsx";
import { Pill } from "./pill.tsx";
import { Tag, TagGroup } from "./tag.tsx";
import { Avatar } from "./avatar.tsx";
import { Alert, AlertContent } from "./alert.tsx";
import { Status } from "./status.tsx";
import { List, ListItem } from "./list.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Shimmer } from "./shimmer.tsx";
import { ProgressBar } from "./progress-bar.tsx";
import { ScrollFade } from "./scroll-fade.tsx";
import { FileType, FileTypeThumb } from "./file-type.tsx";
import { CodeBlock } from "./code-block.tsx";
import { Input } from "./input.tsx";
import { Textarea } from "./textarea.tsx";
import { Label } from "./label.tsx";
import { Checkbox } from "./checkbox.tsx";
import { Radio } from "./radio.tsx";
import { Switch } from "./switch.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import { Tabs, TabsItem } from "./tabs.tsx";
import { Drawer, DrawerContent, DrawerTrigger } from "./drawer.tsx";
import { Command, CommandItem, CommandList } from "./command.tsx";
import { AppShell } from "./app-shell.tsx";
import { ColorModeProvider, ColorModeToggle } from "./color-mode.tsx";
import { Separator } from "./separator.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion.tsx";
import { AspectRatio } from "./aspect-ratio.tsx";
import { NumberField } from "./number-field.tsx";
import { Slider } from "./slider.tsx";
import { Toggle } from "./toggle.tsx";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.tsx";

// ---------------------------------------------------------------------------
// jsdom harness — installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) so effect-driven components mount.
// ---------------------------------------------------------------------------
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = [
    "document",
    "window",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "MouseEvent",
    "getComputedStyle",
    "ResizeObserver",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];

  g.document = w.document;
  g.window = w;
  g.navigator = w.navigator;
  g.HTMLElement = w.HTMLElement;
  g.Node = w.Node;
  g.Element = w.Element;
  g.MouseEvent = w.MouseEvent;
  g.getComputedStyle = (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w);
  g.ResizeObserver = ResizeObserverStub;
  g.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

/** Render `element` into a fresh DOM; returns the host node and a teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  unmount: () => void;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tier 1 — single-node leaves. Assert one node · ref · {...props} · className.
// ---------------------------------------------------------------------------
interface LeafCase {
  name: string;
  // deno-lint-ignore no-explicit-any
  render: (probe: Record<string, any>) => React.ReactElement;
}

const LEAVES: LeafCase[] = [
  { name: "Button", render: (p) => <Button {...p}>Save</Button> },
  { name: "Badge", render: (p) => <Badge {...p}>New</Badge> },
  { name: "Pill", render: (p) => <Pill {...p}>Filter</Pill> },
  { name: "Tag", render: (p) => <Tag {...p}>label</Tag> },
  { name: "Avatar", render: (p) => <Avatar name="Jane Doe" {...p} /> },
  { name: "Status", render: (p) => <Status label="Online" color="green" {...p} /> },
  { name: "Skeleton", render: (p) => <Skeleton {...p} /> },
  { name: "ProgressBar", render: (p) => <ProgressBar percent={40} {...p} /> },
  { name: "FileType", render: (p) => <FileType extension="pdf" {...p} /> },
  { name: "Input", render: (p) => <Input {...p} /> },
  { name: "Textarea", render: (p) => <Textarea {...p} /> },
  { name: "Label", render: (p) => <Label {...p}>Name</Label> },
  { name: "Card", render: (p) => <Card {...p}>content</Card> },
  { name: "Separator", render: (p) => <Separator {...p} /> },
  { name: "AspectRatio", render: (p) => <AspectRatio ratio={16 / 9} {...p} /> },
  { name: "Toggle", render: (p) => <Toggle {...p}>B</Toggle> },
  { name: "NumberField", render: (p) => <NumberField {...p} /> },
  { name: "Slider", render: (p) => <Slider {...p} /> },
];

describe("veryfront/ui conformance — leaves (one node · ref · {...props} · className)", () => {
  for (const leaf of LEAVES) {
    it(`${leaf.name}: renders one node, forwards ref, spreads data-*, merges className`, () => {
      const ref = React.createRef<HTMLElement>();
      const { host, unmount } = render(
        leaf.render({ ref, "data-probe": "x", className: "vf-probe" }),
      );
      try {
        assert(host.children.length === 1, `${leaf.name} must render exactly one root node`);
        const node = host.children[0] as HTMLElement;
        assert(
          node.getAttribute("data-probe") === "x",
          `${leaf.name} must spread {...props} (data-probe)`,
        );
        assert(node.className.includes("vf-probe"), `${leaf.name} must merge className`);
        assert(ref.current === node, `${leaf.name} must forward ref to its node`);
      } finally {
        unmount();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Tier 2 — compounds / context-driven. Smoke: renders ≥1 node without throwing.
// ---------------------------------------------------------------------------
interface SmokeCase {
  name: string;
  render: () => React.ReactElement;
}

const SMOKE: SmokeCase[] = [
  { name: "LoadingButton", render: () => <LoadingButton isLoading>Save</LoadingButton> },
  {
    name: "IconButton",
    render: () => <IconButton tooltip="Settings">icon</IconButton>,
  },
  {
    name: "CardCompound",
    render: () => (
      <Card>
        <CardHeader>Title</CardHeader>
        <CardContent>Body</CardContent>
      </Card>
    ),
  },
  {
    name: "TagGroup",
    render: () => (
      <TagGroup>
        <Tag>one</Tag>
        <Tag>two</Tag>
      </TagGroup>
    ),
  },
  {
    name: "Alert",
    render: () => (
      <Alert>
        <AlertContent>Heads up</AlertContent>
      </Alert>
    ),
  },
  {
    name: "List",
    render: () => (
      <List>
        <ListItem>Item</ListItem>
      </List>
    ),
  },
  { name: "Shimmer", render: () => <Shimmer>Loading</Shimmer> },
  { name: "ScrollFade", render: () => <ScrollFade>scrollable</ScrollFade> },
  { name: "FileTypeThumb", render: () => <FileTypeThumb extension="png" /> },
  { name: "CodeBlock", render: () => <CodeBlock code="const x = 1;" language="ts" /> },
  { name: "Checkbox", render: () => <Checkbox aria-label="Accept" /> },
  { name: "Radio", render: () => <Radio name="g" value="a" aria-label="A" /> },
  { name: "Switch", render: () => <Switch aria-label="Wifi" /> },
  {
    name: "Collapsible",
    render: () => (
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Body</CollapsibleContent>
      </Collapsible>
    ),
  },
  {
    name: "Tabs",
    render: () => (
      <Tabs value="a" onValueChange={() => {}}>
        <TabsItem value="a">A</TabsItem>
        <TabsItem value="b">B</TabsItem>
      </Tabs>
    ),
  },
  {
    name: "Drawer",
    render: () => (
      <Drawer defaultOpen>
        <DrawerTrigger>Open</DrawerTrigger>
        <DrawerContent>Panel</DrawerContent>
      </Drawer>
    ),
  },
  {
    name: "Command",
    render: () => (
      <Command>
        <CommandList>
          <CommandItem>Run</CommandItem>
        </CommandList>
      </Command>
    ),
  },
  { name: "AppShell", render: () => <AppShell>main content</AppShell> },
  {
    name: "ToggleGroup",
    render: () => (
      <ToggleGroup type="single" defaultValue="a">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>
    ),
  },
  {
    name: "Accordion",
    render: () => (
      <Accordion type="single" collapsible defaultValue="a">
        <AccordionItem value="a">
          <AccordionTrigger>Section A</AccordionTrigger>
          <AccordionContent>Body A</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>Section B</AccordionTrigger>
          <AccordionContent>Body B</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
  },
  {
    name: "ColorModeToggle",
    render: () => (
      <ColorModeProvider>
        <ColorModeToggle />
      </ColorModeProvider>
    ),
  },
];

describe("veryfront/ui conformance — compounds (smoke render)", () => {
  for (const c of SMOKE) {
    it(`${c.name}: renders at least one node without throwing`, () => {
      const { host, unmount } = render(c.render());
      try {
        assert(
          host.querySelectorAll("*").length >= 1,
          `${c.name} must render at least one node`,
        );
      } finally {
        unmount();
      }
    });
  }
});
