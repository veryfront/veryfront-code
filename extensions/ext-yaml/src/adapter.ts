import { parse } from "@std/yaml/parse";
import {
  createSkillDocumentParserProvider,
  type SkillDocumentParserProvider,
} from "veryfront/extensions/parser";

/** Create the official @std/yaml-backed Skill frontmatter parser. */
export function createStdYamlSkillDocumentParserProvider(): Readonly<
  SkillDocumentParserProvider
> {
  return createSkillDocumentParserProvider((source) =>
    parse(source, {
      allowDuplicateKeys: false,
      schema: "json",
    })
  );
}
