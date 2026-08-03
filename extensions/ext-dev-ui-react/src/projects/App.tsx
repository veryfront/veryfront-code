import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "./components/EmptyState.tsx";
import { Header } from "./components/Header.tsx";
import { ProjectCard } from "./components/ProjectCard.tsx";
import { SearchInput } from "./components/SearchInput.tsx";
import {
  expectJsonArray,
  expectJsonBoolean,
  expectJsonObject,
  expectJsonString,
  requestJson,
  runOwnedRequest,
  useLatestRequestOwner,
} from "../browser-request.ts";

/** Maximum projects to fetch per request */
const PROJECTS_FETCH_LIMIT = 100;
const MAX_PROJECT_ID_CHARACTERS = 512;
const MAX_PROJECT_NAME_CHARACTERS = 512;
const MAX_PROJECT_DESCRIPTION_CHARACTERS = 8_192;
const MAX_PROJECT_TIMESTAMP_CHARACTERS = 128;

interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  updated_at?: string;
}

export interface Config {
  domain: string;
  port: string;
  hasToken: boolean;
}

const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isCanonicalHostname(value: string): boolean {
  return value.length > 0 && value.length <= 253 && value === value.toLowerCase() &&
    value.split(".").every((label) => HOSTNAME_LABEL_PATTERN.test(label));
}

function isCanonicalPort(value: string): boolean {
  if (value === "") return true;
  if (!/^[1-9][0-9]{0,4}$/.test(value)) return false;
  return Number(value) <= 65_535;
}

function optionalProjectString(
  record: Record<string, unknown>,
  field: "description" | "updated_at",
  maxCharacters: number,
): string | undefined {
  const value = record[field];
  return value === undefined
    ? undefined
    : expectJsonString(value, `project.${field}`, maxCharacters);
}

export function admitProjectsResponse(value: unknown): Project[] {
  const response = expectJsonObject(value, "projects response");
  const entries = expectJsonArray(response.data, "projects response.data", PROJECTS_FETCH_LIMIT);
  const ids = new Set<string>();

  return entries.map((entry, index) => {
    const project = expectJsonObject(entry, `projects response.data[${index}]`);
    const id = expectJsonString(
      project.id,
      `projects response.data[${index}].id`,
      MAX_PROJECT_ID_CHARACTERS,
      false,
    );
    if (ids.has(id)) throw new TypeError(`projects response contains duplicate id ${id}`);
    ids.add(id);

    const slug = expectJsonString(
      project.slug,
      `projects response.data[${index}].slug`,
      253,
      false,
    );
    if (!isCanonicalHostname(slug)) {
      throw new TypeError(`projects response.data[${index}].slug is not a canonical hostname`);
    }

    const updatedAt = optionalProjectString(
      project,
      "updated_at",
      MAX_PROJECT_TIMESTAMP_CHARACTERS,
    );
    if (updatedAt !== undefined && !Number.isFinite(Date.parse(updatedAt))) {
      throw new TypeError(`projects response.data[${index}].updated_at is not a timestamp`);
    }

    return {
      id,
      name: expectJsonString(
        project.name,
        `projects response.data[${index}].name`,
        MAX_PROJECT_NAME_CHARACTERS,
        false,
      ),
      slug,
      description: optionalProjectString(
        project,
        "description",
        MAX_PROJECT_DESCRIPTION_CHARACTERS,
      ),
      updated_at: updatedAt,
    };
  });
}

export function admitProjectsConfig(value: unknown): Config {
  const config = expectJsonObject(value, "projects config");
  const domain = expectJsonString(config.domain, "projects config.domain", 253, false);
  const port = expectJsonString(config.port, "projects config.port", 5);
  if (!isCanonicalHostname(domain)) {
    throw new TypeError("projects config.domain is not a canonical hostname");
  }
  if (!isCanonicalPort(port)) throw new TypeError("projects config.port is not canonical");

  return {
    domain,
    port,
    hasToken: expectJsonBoolean(config.hasToken, "projects config.hasToken"),
  };
}

/** Construct a project origin without trusting server-returned URL syntax. */
export function getProjectUrl(
  config: Pick<Config, "domain" | "port">,
  slug: string,
  currentLocation: string = globalThis.location.href,
): string | null {
  if (!isCanonicalHostname(slug) || !isCanonicalHostname(config.domain)) return null;
  if (!isCanonicalPort(config.port)) return null;

  let target: URL;
  try {
    target = new URL("/", currentLocation);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;

  const hostname = `${slug}.${config.domain}`;
  if (hostname.length > 253) return null;
  target.hostname = hostname;
  target.port = config.port;
  target.username = "";
  target.password = "";
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  return target.href;
}

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const configRequests = useLatestRequestOwner();
  const projectRequests = useLatestRequestOwner();

  useEffect(() => {
    void runOwnedRequest(
      configRequests,
      (signal) =>
        requestJson("/_projects/api/config", {
          responseLabel: "Projects config",
          admit: admitProjectsConfig,
          init: { signal },
        }),
      {
        success: setConfig,
        error: (requestError) => console.error("Failed to load projects config:", requestError),
      },
    );
  }, [configRequests]);

  const fetchProjects = useCallback((searchQuery: string): Promise<void> => {
    return runOwnedRequest(
      projectRequests,
      (signal) => {
        const params = new URLSearchParams({
          sort_by: "updated_at",
          sort_order: "desc",
          limit: String(PROJECTS_FETCH_LIMIT),
        });

        if (searchQuery) params.set("search", searchQuery);

        return requestJson(`/_vf/api/projects?${params}`, {
          responseLabel: "Projects",
          admit: admitProjectsResponse,
          init: { signal },
        });
      },
      {
        start: () => {
          setLoading(true);
          setError(null);
        },
        success: setProjects,
        error: (requestError) => {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
          setProjects([]);
        },
        finish: () => setLoading(false),
      },
    );
  }, [projectRequests]);

  useEffect(() => {
    projectRequests.cancel();
    setLoading(true);
    setError(null);

    if (search === "") {
      void fetchProjects("");
      return;
    }

    const timer = setTimeout(() => {
      void fetchProjects(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [fetchProjects, projectRequests, search]);

  function renderContent(): React.JSX.Element {
    if (error) {
      return (
        <EmptyState
          title="Unable to load projects"
          description={error}
          variant="error"
        />
      );
    }

    if (loading && projects.length === 0) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-5 border border-gray-200 animate-pulse"
            >
              <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-4" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      );
    }

    if (projects.length === 0) {
      const title = search ? "No projects found" : "No projects yet";
      const description = search
        ? "Try a different search term"
        : "Create a project to get started";

      return <EmptyState title={title} description={description} showWorkspaceGuide={!search} />;
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            name={project.name}
            slug={project.slug}
            description={project.description}
            updatedAt={project.updated_at}
            href={config ? getProjectUrl(config, project.slug) ?? "#" : "#"}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <Header />
          {config?.hasToken
            ? (
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search..."
                loading={loading && search.length > 0}
              />
            )
            : null}
        </div>

        {renderContent()}
      </div>
    </div>
  );
}
