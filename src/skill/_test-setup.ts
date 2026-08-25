/** Test-only composition root for the first-party Skill YAML implementation. */

import { register, tryResolve } from "../extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "../extensions/parser/skill-document-parser.ts";
import { createStdYamlSkillDocumentParserProvider } from "../../extensions/ext-yaml/src/adapter.ts";

export function ensureTestSkillDocumentParser(): void {
  if (
    tryResolve<SkillDocumentParserProvider>(
      SkillDocumentParserProviderName,
    ) === undefined
  ) {
    register(
      SkillDocumentParserProviderName,
      createStdYamlSkillDocumentParserProvider(),
    );
  }
}

ensureTestSkillDocumentParser();
