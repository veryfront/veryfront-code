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
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../../../src/react/components/ui/index.ts";

const importCode =
  `import {\n  Pagination,\n  PaginationContent,\n  PaginationItem,\n  PaginationLink,\n  PaginationPrevious,\n  PaginationNext,\n  PaginationEllipsis,\n} from "veryfront/ui"`;

const compositionTree = `Pagination            (nav[aria-label="pagination"])
└─ PaginationContent  (ul)
   └─ PaginationItem  (li)
      ├─ PaginationPrevious
      ├─ PaginationLink (isActive?)
      ├─ PaginationEllipsis
      └─ PaginationNext`;

function PaginationDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Pagination"
        lead="Landmark navigation for paging through a list — Previous, numbered pages, an ellipsis gap, and Next."
      />

      <DocsSection
        title="Full pager"
        description="A complete pager with Previous, pages 1–3, an ellipsis, and Next. Page 2 is the current page (aria-current='page')."
      >
        <DocsExampleAuto of={FullPager} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="PaginationLink"
          description="A page link; the rest of the compound (Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext, PaginationEllipsis) takes only className + native attributes."
          props={[
            {
              name: "isActive",
              type: "boolean",
              default: "false",
              description: "Marks the current page — sets aria-current='page' and active styling",
            },
            {
              name: "href",
              type: "string",
              description: "Destination for the page link (native anchor attribute)",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Pagination",
  component: Pagination,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: PaginationDocsPage },
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullPager: Story = {
  tags: ["!dev"],
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
};
