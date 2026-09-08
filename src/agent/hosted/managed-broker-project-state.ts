import type { AgentSystem } from "../types.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  createStrictRuntimeProjectFilesClient,
  type RuntimeGetProjectFileOptions,
  type RuntimeProjectFilesApiOptions,
} from "../runtime/project-files-client.ts";
import {
  getRuntimeProjectInstructions,
  getRuntimeProjectSkillCatalog,
} from "../runtime/project-skill-catalog.ts";
import {
  resolveRuntimeSkillSelectorSnapshotForAgent,
  type RuntimeSkillDefinition,
} from "../runtime/skill-metadata.ts";
import {
  assertResolvedSkillSelector,
  createNoneSkillSelectorSnapshot,
} from "#veryfront/skill/selector.ts";
import type { SkillDocumentParserProvider } from "#veryfront/extensions/parser/skill-document-parser.ts";
import { buildInteractiveVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import type { HostedChatRuntimeProjectSteering } from "./chat-runtime-contract.ts";

type Scope = { projectId: string | null; branchId?: string | null };

export function createManagedBrokerProjectState(
  options: Scope & {
    apiUrl: string | URL;
    authToken: string;
    agentId: string;
    builtinSkills?: readonly RuntimeSkillDefinition[];
    skillDocumentParserProvider?: SkillDocumentParserProvider;
    environmentContext?: string;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    latestConversationUserText?: (signal: AbortSignal) => Promise<string | null>;
  },
) {
  if (!options.agentId || !options.authToken) {
    throw new TypeError("Managed broker project state requires fixed identity and authorization");
  }
  const projectId = options.projectId;
  const branchId = options.branchId;
  const authToken = options.authToken;
  const projectClient = createStrictRuntimeProjectFilesClient({
    apiUrl: new URL(options.apiUrl).toString(),
    fetch: options.fetch,
  });
  const builtinSkills = [...options.builtinSkills ?? []];
  let definition: RuntimeAgentMarkdownDefinition | undefined;
  const assertScope = (input: Scope) => {
    if (input.projectId !== projectId || input.branchId !== branchId) {
      throw new TypeError("Managed broker project state scope cannot change");
    }
  };
  const fileReader = (signal: AbortSignal) => async (input: RuntimeGetProjectFileOptions) => {
    assertScope(input);
    if (input.authToken !== authToken || projectId === null) {
      throw new TypeError("Managed broker project authorization cannot change");
    }
    return await projectClient.getProjectFile({ ...input, signal });
  };
  const fileLister = (signal: AbortSignal) => async (input: RuntimeProjectFilesApiOptions) => {
    assertScope(input);
    if (input.authToken !== authToken || projectId === null) {
      throw new TypeError("Managed broker project authorization cannot change");
    }
    return await projectClient.getProjectFiles({ ...input, signal });
  };
  const load = async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (projectId === null) return { instructions: "", skills: [] as RuntimeSkillDefinition[] };
    const lookup = { projectId, branchId, authToken };
    const [instructions, skills] = await Promise.all([
      getRuntimeProjectInstructions({ ...lookup, getProjectFile: fileReader(signal) }),
      getRuntimeProjectSkillCatalog({
        ...lookup,
        getProjectFile: fileReader(signal),
        getProjectFiles: fileLister(signal),
        builtinSkills,
        skillDocumentParserProvider: options.skillDocumentParserProvider,
      }),
    ]);
    signal.throwIfAborted();
    return { instructions, skills };
  };
  const select = (agent: RuntimeAgentMarkdownDefinition, skills: RuntimeSkillDefinition[]) => {
    if (agent.skills === false) return createNoneSkillSelectorSnapshot<RuntimeSkillDefinition>();
    const selected = resolveRuntimeSkillSelectorSnapshotForAgent({
      skills,
      agentId: agent.id,
      selector: agent.skills,
    });
    assertResolvedSkillSelector(selected);
    return selected;
  };
  return {
    async prepareProjectSteering(
      input: Scope & {
        definition: RuntimeAgentMarkdownDefinition;
        signal: AbortSignal;
      },
    ): Promise<HostedChatRuntimeProjectSteering<RuntimeAgentMarkdownDefinition>> {
      assertScope(input);
      if (input.definition.id !== options.agentId) {
        throw new TypeError("Managed broker project agent cannot change");
      }
      const loaded = await load(input.signal);
      const selected = select(input.definition, loaded.skills);
      definition = structuredClone(input.definition);
      return {
        agent: structuredClone(input.definition),
        skillSelectorPolicy: selected.policy,
        ...(options.environmentContext ? { environmentContext: options.environmentContext } : {}),
        ...(loaded.instructions ? { initialProjectInstructions: loaded.instructions } : {}),
        ...(selected.definitions.length ? { initialSkills: selected.definitions } : {}),
      };
    },
    async refreshProjectSteering(signal: AbortSignal): Promise<AgentSystem> {
      if (!definition) throw new TypeError("Managed broker project state is not prepared");
      const loaded = await load(signal);
      const selected = select(definition, loaded.skills);
      return buildInteractiveVeryfrontCloudRuntimeInstructions({
        agentConfig: definition,
        projectId,
        branchId,
        instructions: loaded.instructions,
        skills: selected.definitions,
        environmentContext: options.environmentContext,
      });
    },
    ...(options.latestConversationUserText
      ? {
        latestConversationUserText: async (signal: AbortSignal) => {
          signal.throwIfAborted();
          return await options.latestConversationUserText!(signal);
        },
      }
      : {}),
  };
}
