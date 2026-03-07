import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "./components/EmptyState.tsx";
import { Header } from "./components/Header.tsx";
import { ProjectCard } from "./components/ProjectCard.tsx";
import { SearchInput } from "./components/SearchInput.tsx";

/** Maximum projects to fetch per request */
const PROJECTS_FETCH_LIMIT = 100;

interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  updated_at?: string;
}

interface Config {
  domain: string;
  port: string;
  hasToken: boolean;
}

export function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    async function loadConfig(): Promise<void> {
      try {
        const r = await fetch("/_projects/api/config");
        const data = await r.json();
        setConfig(data);
      } catch (e) {
        console.error("Failed to load config:", e);
      }
    }
    loadConfig();
  }, []);

  const fetchProjects = useCallback(async (searchQuery: string): Promise<void> => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        sort_by: "updated_at",
        sort_order: "desc",
        limit: String(PROJECTS_FETCH_LIMIT),
      });

      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/_vf/api/projects?${params}`, {
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? data.detail ?? "Failed to load projects");
        setProjects([]);
        return;
      }

      setProjects(data.data ?? []);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects("");
  }, [fetchProjects]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProjects(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [fetchProjects, search]);

  function getProjectUrl(slug: string): string {
    if (!config) return "#";
    const portSuffix = config.port ? `:${config.port}` : "";
    return `http://${slug}.${config.domain}${portSuffix}/`;
  }

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
            href={getProjectUrl(project.slug)}
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
