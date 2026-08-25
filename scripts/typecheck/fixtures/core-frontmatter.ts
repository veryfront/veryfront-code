// Consumer fixture for the root package declaration emitted by dnt.
import type { MDXFrontmatter } from "veryfront";

const customFrontmatterValue: string | number | boolean | string[] | undefined = true;

export const frontmatter: MDXFrontmatter = {
  title: "Consumer page",
  custom: customFrontmatterValue,
};

export const legacyCustomValue: string | number | boolean | string[] | undefined =
  frontmatter.custom;
