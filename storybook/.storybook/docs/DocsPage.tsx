import {
  Controls,
  Description,
  DocsContext,
  Title,
} from "@storybook/addon-docs/blocks";
import * as React from "react";
import { DocsExample } from "./DocsExample";

// Custom autodocs template. Mirrors the Veryfront Studio docs layout: a title,
// description, one Preview/Code example per story, then the controls table —
// rendered full width (no right-hand table of contents). Story enumeration
// follows Storybook's own `Stories` block: `componentStories()` filtered to
// autodocs entries that do not mount themselves.
export function DocsPage(): React.ReactElement {
  const context = React.useContext(DocsContext);
  const stories = context.componentStories().filter(
    (story) =>
      story?.tags?.includes("autodocs") && !story.usesMount,
  );

  return (
    <>
      <Title />
      <Description />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
      >
        {stories.map((story) => (
          <section
            key={story.id}
            style={{
              paddingTop: "64px",
              marginTop: "64px",
              borderTop: "1px solid oklch(from var(--foreground) l c h / 0.08)",
            }}
          >
            <h3
              style={{
                margin: "0 0 20px",
                fontSize: "18px",
                fontWeight: 600,
                color: "var(--foreground, #0f0f0f)",
              }}
            >
              {story.name}
            </h3>
            <DocsExample of={story.moduleExport} />
          </section>
        ))}
      </div>
      <Controls />
    </>
  );
}
