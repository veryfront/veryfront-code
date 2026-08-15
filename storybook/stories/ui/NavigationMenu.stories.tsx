import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "veryfront/ui"`;

const compositionTree = `NavigationMenu           nav[aria-label]  (owns open panel)
└─ NavigationMenuList    ul
   ├─ NavigationMenuItem  li  value="products"
   │  ├─ NavigationMenuTrigger  button[aria-expanded]
   │  └─ NavigationMenuContent  div[data-slot=navigation-menu-content]  (disclosure/link panel)
   │     └─ NavigationMenuLink  a
   └─ NavigationMenuItem  li  value="docs"
      └─ NavigationMenuLink  a   (plain top-level link)`;

function NavigationMenuDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="NavigationMenu"
        lead="A horizontal site-navigation bar whose items open dropdown panels of links. Only one panel is open at a time; plain top-level links are supported too."
      />

      <DocsSection
        title="With dropdown panels"
        description="Two items each open a panel of links; hover over or select the trigger to open. A third item is a plain link with no panel."
      >
        <DocsExampleAuto of={WithPanels} />
      </DocsSection>

      <DocsSection
        title="Active link"
        description="Pass active to mark the current page: it gets aria-current='page' and active styling."
      >
        <DocsExampleAuto of={ActiveLink} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="NavigationMenu"
          description="Navigation landmark that owns which item's panel is open"
          props={[
            {
              name: "label",
              type: "string",
              default: "'Main'",
              description: "Accessible name for the nav landmark",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="NavigationMenuItem"
          description="One item in the bar; provides its value to its trigger/panel"
          props={[
            {
              name: "value",
              type: "string",
              description: "Stable id linking the item's trigger to its panel and open state",
            },
          ]}
        />
        <DocsPropsTable
          component="NavigationMenuTrigger"
          description="Button that toggles its item's panel"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="NavigationMenuContent"
          description="Dropdown panel, rendered only while its item is open"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
        <DocsPropsTable
          component="NavigationMenuLink"
          description="A navigable link, inside a panel or as a plain top-level item"
          props={[
            {
              name: "active",
              type: "boolean",
              default: "false",
              description: "Marks the link as the current page",
            },
            {
              name: "href",
              type: "string",
              description: "The link destination",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/NavigationMenu",
  component: NavigationMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: NavigationMenuDocsPage },
  },
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithPanels: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="h-52">
      <NavigationMenu label="Main">
        <NavigationMenuList>
          <NavigationMenuItem value="products">
            <NavigationMenuTrigger>Products</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/analytics">Analytics</NavigationMenuLink>
              <NavigationMenuLink href="/automation">Automation</NavigationMenuLink>
              <NavigationMenuLink href="/reporting">Reporting</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="resources">
            <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/guides">Guides</NavigationMenuLink>
              <NavigationMenuLink href="/blog">Blog</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="docs">
            <NavigationMenuLink href="/docs">Docs</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  ),
};

export const ActiveLink: Story = {
  tags: ["!dev"],
  render: () => (
    <NavigationMenu label="Main">
      <NavigationMenuList>
        <NavigationMenuItem value="home">
          <NavigationMenuLink href="/" active>Home</NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem value="pricing">
          <NavigationMenuLink href="/pricing">Pricing</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};
