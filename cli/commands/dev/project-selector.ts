import type { RemoteProject } from "../../sync/index.ts";
import {
  type PromptDisplayOptions,
  PromptInterruptedError,
  select,
  type SelectOption,
} from "../../utils/terminal-select.ts";

type SelectOptionFn = (
  question: string,
  options: SelectOption[],
  defaultIndex?: number,
  display?: PromptDisplayOptions,
) => Promise<string | null>;

interface ProjectSelectorOptions {
  prepare?: () => Promise<void>;
  getProjects: () => RemoteProject[];
  getSelectedProjectId: () => string | null;
  pauseKeyboard: () => void;
  resumeKeyboard: () => void;
  onEmpty?: () => void;
  onInterrupt?: () => void;
  onSelect: (project: RemoteProject) => void;
  selectOption?: SelectOptionFn;
}

export interface ProjectSelector {
  open: () => Promise<void>;
}

const PROJECT_PROMPT_DISPLAY: PromptDisplayOptions = {
  showMarker: false,
  showInstructions: false,
  showDescriptions: false,
  clearOnCancel: true,
  interruptOnCtrlC: true,
};

export function createProjectSelector(options: ProjectSelectorOptions): ProjectSelector {
  let open = false;

  return {
    async open(): Promise<void> {
      if (open) return;

      open = true;
      let interrupted = false;
      options.pauseKeyboard();

      try {
        if (options.prepare) await options.prepare();
        const projects = options.getProjects();
        if (projects.length === 0) {
          options.onEmpty?.();
          return;
        }

        const selectedId = options.getSelectedProjectId();
        const selectedIndex = Math.max(
          0,
          projects.findIndex((project) => project.id === selectedId),
        );
        const projectId = await (options.selectOption ?? select)(
          "Select project:",
          projects.map((project) => ({ value: project.id, label: project.name })),
          selectedIndex,
          PROJECT_PROMPT_DISPLAY,
        );
        if (!projectId) return;

        const project = projects.find((candidate) => candidate.id === projectId);
        if (project) options.onSelect(project);
      } catch (error) {
        if (error instanceof PromptInterruptedError) {
          interrupted = true;
          options.onInterrupt?.();
          return;
        }
        throw error;
      } finally {
        open = false;
        if (!interrupted || !options.onInterrupt) options.resumeKeyboard();
      }
    },
  };
}
