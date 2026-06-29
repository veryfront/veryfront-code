import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Head } from "../../../src/react/components/Head.tsx";
import {
  MDXProvider,
  useMDXComponents,
} from "../../../src/react/components/MDXProvider.tsx";
import { OptimizedImage } from "../../../src/react/components/optimized-image/index.ts";

const meta = {
  title: "Veryfront UI/Framework Components",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const fallbackImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%23f4f1eb'/%3E%3Cpath d='M120 390h720L650 170 500 310l-95-95z' fill='%23282828' opacity='.16'/%3E%3Ccircle cx='300' cy='190' r='58' fill='%23282828' opacity='.22'/%3E%3C/svg%3E";

function MDXPreview(): React.ReactElement {
  const components = useMDXComponents();
  const Callout = components.Callout as React.ComponentType<
    { children: React.ReactNode }
  >;

  return (
    <Callout>
      MDXProvider supplies component overrides to MDX-rendered content.
    </Callout>
  );
}

export const FrameworkGallery: Story = {
  render: () => (
    <div className="vf-story-canvas">
      <div className="mx-auto max-w-5xl vf-component-grid">
        <section className="vf-component-surface">
          <p className="vf-component-label">OptimizedImage</p>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--outline-border)]">
            <OptimizedImage
              src="/storybook/veryfront-preview.png"
              alt="Veryfront preview"
              width={960}
              height={540}
              className="aspect-video w-full object-cover"
              priority
              onError={(event) => {
                event.currentTarget.removeAttribute("srcset");
                event.currentTarget.src = fallbackImage;
              }}
            />
          </div>
        </section>

        <section className="vf-component-surface">
          <p className="vf-component-label">MDXProvider</p>
          <MDXProvider
            components={{
              Callout: ({ children }: { children: React.ReactNode }) => (
                <div className="rounded-[var(--radius-lg)] border border-[var(--outline-border)] bg-[var(--tertiary)] p-4 text-sm leading-6">
                  {children}
                </div>
              ),
            }}
          >
            <MDXPreview />
          </MDXProvider>
        </section>

        <section className="vf-component-surface">
          <p className="vf-component-label">Head</p>
          <Head>
            <title>Veryfront Storybook preview</title>
            <meta name="description" content="Veryfront UI component review" />
          </Head>
          <div className="rounded-[var(--radius-lg)] border border-[var(--outline-border)] p-4 text-sm leading-6">
            <p className="font-medium">Document metadata preview</p>
            <p className="mt-2 text-[var(--faint)]">
              The Head component can be rendered inside Storybook without
              changing the page frame.
            </p>
          </div>
        </section>
      </div>
    </div>
  ),
};
