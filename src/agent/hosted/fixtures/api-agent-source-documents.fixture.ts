/**
 * Agent documents served by veryfront-api `GET /projects/{project}/agents/{agent_id}`
 * (operation `getAgentSource`, OpenAPI `AgentSource`).
 *
 * Captured on veryfront-api main (647d601bef, after #6470) by running the real
 * `getProjectAgentDocument` reader and `toRestProjectAgentDocument` mapper over
 * the source kept in each document's `source` field, then parsing every result
 * through `RestProjectAgentDocumentSchema`. Do not hand-edit: re-capture
 * instead, so the hosted resolver tests stay pinned to the shape the API sends.
 */
export const API_AGENT_SOURCE_DOCUMENTS = {
  "tools_false_markdown": {
    "id": "lifecycle-eval-triage",
    "name": "Lifecycle Eval Triage",
    "description": "Triage pasted messages.",
    "model": null,
    "system_prompt": "You are Lifecycle Eval Triage. Do not use tools.",
    "temperature": 0.2,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "tools": false,
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/lifecycle-eval-triage.md",
    "source":
      "---\nname: Lifecycle Eval Triage\ndescription: Triage pasted messages.\ntools: false\ntemperature: 0.2\n---\nYou are Lifecycle Eval Triage. Do not use tools.\n",
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "tools_false_typescript": {
    "id": "no-tools",
    "name": "No Tools",
    "description": null,
    "model": null,
    "system_prompt": "Answer from the prompt only.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "tools": false,
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/no-tools.ts",
    "source":
      'import { agent } from "veryfront/agent";\nexport default agent({ id: "no-tools", name: "No Tools", system: "Answer from the prompt only.", tools: false });\n',
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "tools_false_provider_tools_typescript": {
    "id": "searcher",
    "name": "Searcher",
    "description": null,
    "model": null,
    "system_prompt": "Search the web only.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "tools": false,
    "provider_tool_ids": [
      "web_search",
    ],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/searcher.ts",
    "source":
      'import { agent } from "veryfront/agent";\nexport default agent({ id: "searcher", name: "Searcher", system: "Search the web only.", tools: false, providerTools: ["web_search"] });\n',
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "tool_ids_typescript": {
    "id": "reader",
    "name": "Reader",
    "description": null,
    "model": null,
    "system_prompt": "Read files.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [],
    "skill_selection": {
      "kind": "explicit",
      "skill_ids": [],
    },
    "skill_resolution": {
      "policy": {
        "kind": "none",
      },
      "skill_ids": [],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "skills": [],
    "all_tools_enabled": false,
    "tool_ids": [
      "get_file",
    ],
    "tools": [
      "get_file",
    ],
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/reader.ts",
    "source":
      'import { agent } from "veryfront/agent";\nexport default agent({ id: "reader", name: "Reader", system: "Read files.", tools: ["get_file"], skills: [] });\n',
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "tool_map_typescript": {
    "id": "mapped",
    "name": "Mapped",
    "description": null,
    "model": null,
    "system_prompt": "Use mapped tools.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [
      "get_file",
    ],
    "tools": {
      "get_file": true,
      "load_skill": false,
    },
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/mapped.ts",
    "source":
      'import { agent } from "veryfront/agent";\nexport default agent({ id: "mapped", name: "Mapped", system: "Use mapped tools.", tools: { get_file: true, load_skill: false } });\n',
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "all_tools_typescript": {
    "id": "everything",
    "name": "Everything",
    "description": null,
    "model": null,
    "system_prompt": "Use any tool.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": true,
    "tool_ids": [],
    "tools": true,
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/everything.ts",
    "source":
      'import { agent } from "veryfront/agent";\nexport default agent({ id: "everything", name: "Everything", system: "Use any tool.", tools: true });\n',
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "omitted_tools_markdown": {
    "id": "plain",
    "name": "Plain",
    "description": null,
    "model": null,
    "system_prompt": "Answer plainly.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "tools": [],
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/plain.md",
    "source": "---\nname: Plain\n---\nAnswer plainly.\n",
    "edit_mode": "structured",
    "source_only_reasons": [],
  },
  "source_only_typescript": {
    "id": "dynamic",
    "name": "Dynamic",
    "description": null,
    "model": null,
    "system_prompt": null,
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "explicit",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": null,
    "source_path": "agents/dynamic.ts",
    "source":
      'import { agent } from "veryfront/agent";\nimport { buildPrompt } from "../lib/prompt";\nexport default agent({ id: "dynamic", name: "Dynamic", system: buildPrompt(), tools: false });\n',
    "edit_mode": "source_only",
    "source_only_reasons": [
      "Agent source does not match a supported writable shape.",
    ],
  },
  "source_only_markdown": {
    "id": "hand-written",
    "name": "Hand Written",
    "description": null,
    "model": null,
    "system_prompt": null,
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [],
    "skill_selection": {
      "kind": "explicit",
      "skill_ids": [],
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": null,
    "source_path": "agents/hand-written.md",
    "source":
      "---\nname: Hand Written\ntools: maybe\n---\nYou are Hand Written. Answer without tools.\n",
    "edit_mode": "source_only",
    "source_only_reasons": [
      "Agent source could not be parsed.",
    ],
  },
  "source_only_typescript_projected": {
    "id": "hooked",
    "name": "Hooked",
    "description": null,
    "model": null,
    "system_prompt": "You are Hooked.",
    "temperature": null,
    "max_steps": null,
    "allowed_models": [],
    "skill_ids": [
      "navigation-notes",
    ],
    "skill_selection": {
      "kind": "omitted",
      "skill_ids": [
        "navigation-notes",
      ],
    },
    "skill_resolution": {
      "policy": {
        "kind": "all-visible",
        "source": "omitted",
      },
      "skill_ids": [
        "navigation-notes",
      ],
      "source_paths": {},
      "unresolved_entry_indexes": [],
      "catalog_status": "complete",
      "evidence_scope": "source_catalog",
    },
    "all_tools_enabled": false,
    "tool_ids": [],
    "tools": false,
    "provider_tool_ids": [],
    "avatar_url": null,
    "security_enabled": true,
    "source_path": "agents/hooked.ts",
    "source":
      'import { agent } from "veryfront/agent";\nconsole.log("loading");\nexport default agent({ id: "hooked", name: "Hooked", system: "You are Hooked.", tools: false });\n',
    "edit_mode": "source_only",
    "source_only_reasons": [
      "Agent source contains unsupported top-level statements.",
    ],
  },
} as const;
