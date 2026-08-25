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
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
  BreadcrumbEllipsis,
} from "veryfront/ui"`;

const compositionTree = `Breadcrumb            <nav aria-label="Breadcrumb">
└─ BreadcrumbList     <ol>
   ├─ BreadcrumbItem     <li>
   │  └─ BreadcrumbLink     <a>
   ├─ BreadcrumbSeparator  <li aria-hidden>
   ├─ BreadcrumbEllipsis   <span aria-hidden>…</span>
   └─ BreadcrumbItem     <li>
      └─ BreadcrumbPage    <span aria-current="page">`;

function BreadcrumbDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Breadcrumb"
        lead="A non-interactive navigation trail showing the current page's place in a hierarchy."
      />

      <DocsSection
        title="Basic"
        description="A trail of links ending in the current page, divided by separators."
      >
        <DocsExampleAuto of={Basic} />
      </DocsSection>

      <DocsSection
        title="With ellipsis"
        description="Collapse the middle of a long trail with a BreadcrumbEllipsis."
      >
        <DocsExampleAuto of={WithEllipsis} />
      </DocsSection>

      <DocsSection
        title="Custom separator"
        description="Pass children to BreadcrumbSeparator to replace the default slash."
      >
        <DocsExampleAuto of={CustomSeparator} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="Breadcrumb"
          description="The landmark nav wrapping the trail"
          props={[
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbList"
          description="The ordered list of trail items"
          props={[
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbItem"
          description="A single item wrapping a link, page, or ellipsis"
          props={[
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbLink"
          description="A navigable ancestor link"
          props={[
            { name: "href", type: "string", description: "The link target (standard anchor attribute)" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbPage"
          description="The current page: aria-current='page', non-interactive"
          props={[
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbSeparator"
          description="A decorative divider; renders children or a default '/'"
          props={[
            { name: "children", type: "ReactNode", description: "Custom glyph; defaults to '/'" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="BreadcrumbEllipsis"
          description="A collapsed-trail indicator with an sr-only 'More' label"
          props={[
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Breadcrumb",
  component: Breadcrumb,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: BreadcrumbDocsPage },
  },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  tags: ["!dev"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Billing</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const WithEllipsis: Story = {
  tags: ["!dev"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Billing</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};

export const CustomSeparator: Story = {
  tags: ["!dev"],
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>›</BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbLink href="/docs">Docs</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>›</BreadcrumbSeparator>
        <BreadcrumbItem>
          <BreadcrumbPage>Breadcrumb</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
};
