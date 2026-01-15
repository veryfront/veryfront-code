import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header.tsx";
import { SearchInput } from "./components/SearchInput.tsx";
import { ProjectCard } from "./components/ProjectCard.tsx";
import { EmptyState } from "./components/EmptyState.tsx";

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

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch config on mount
  useEffect(() => {
    fetch("/_projects/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch((e) => console.error("Failed to load config:", e));
  }, []);

  // Debounced search - calls BFF proxy endpoint
  const fetchProjects = useCallback(async (searchQuery: string) => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("sort_by", "updated_at");
      params.set("sort_order", "desc");
      params.set("limit", "100");
      if (searchQuery) params.set("search", searchQuery);

      // Call BFF proxy endpoint -> forwards to Veryfront API
      const response = await fetch(`/_vf/api/projects?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || data.detail || "Failed to load projects");
        setProjects([]);
      } else {
        setProjects(data.data || []);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchProjects("");
  }, [fetchProjects]);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProjects(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search, fetchProjects]);

  const getProjectUrl = (slug: string) => {
    if (!config) return "#";
    const portSuffix = config.port ? `:${config.port}` : "";
    return `http://${slug}.${config.domain}${portSuffix}/`;
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <Header />
          {config?.hasToken && (
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search..."
              loading={loading && search.length > 0}
            />
          )}
        </div>

        {error
          ? (
            <EmptyState
              title="Unable to load projects"
              description={error}
              variant="error"
            />
          )
          : loading && projects.length === 0
          ? (
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
          )
          : projects.length === 0
          ? (
            <EmptyState
              title={search ? "No projects found" : "No projects yet"}
              description={search
                ? "Try a different search term"
                : "Create a project to get started"}
            />
          )
          : (
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
          )}
      </div>
    </div>
  );
}
