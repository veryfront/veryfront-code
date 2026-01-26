/**
 * GitHub API Client
 *
 * Provides a type-safe interface to GitHub API operations.
 */

import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changed_files: number;
  draft: boolean;
  labels: Array<{ name: string; color: string }>;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  html_url: string;
  author: { login: string; avatar_url: string } | null;
}

/**
 * GitHub OAuth provider configuration
 */
export const githubOAuthProvider = {
  name: "github",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  clientId: getEnv("GITHUB_CLIENT_ID") || "",
  clientSecret: getEnv("GITHUB_CLIENT_SECRET") || "",
  scopes: ["repo", "read:user", "read:org"],
  callbackPath: "/api/auth/github/callback",
};

export function createGitHubClient(userId: string): {
  listRepos(options?: {
    sort?: "created" | "updated" | "pushed" | "full_name";
    perPage?: number;
    type?: "all" | "owner" | "public" | "private" | "member";
  }): Promise<GitHubRepo[]>;
  listPullRequests(
    owner: string,
    repo: string,
    options?: { state?: "open" | "closed" | "all"; perPage?: number },
  ): Promise<GitHubPullRequest[]>;
  getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest>;
  getPullRequestDiff(owner: string, repo: string, pullNumber: number): Promise<string>;
  createIssue(
    owner: string,
    repo: string,
    options: { title: string; body?: string; labels?: string[]; assignees?: string[] },
  ): Promise<GitHubIssue>;
  listIssues(
    owner: string,
    repo: string,
    options?: { state?: "open" | "closed" | "all"; perPage?: number },
  ): Promise<GitHubIssue[]>;
  listCommits(
    owner: string,
    repo: string,
    options?: { sha?: string; perPage?: number },
  ): Promise<GitHubCommit[]>;
  getUser(): Promise<{ login: string; name: string; email: string }>;
} {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(githubOAuthProvider, userId, "github");
    if (!token) throw new Error("GitHub not connected. Please connect your GitHub account first.");
    return token;
  }

  async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  return {
    listRepos(options = {}): Promise<GitHubRepo[]> {
      const params = new URLSearchParams();
      if (options.sort) params.set("sort", options.sort);
      if (options.perPage) params.set("per_page", String(options.perPage));
      if (options.type) params.set("type", options.type);

      const query = params.toString();
      return apiRequest<GitHubRepo[]>(`/user/repos${query ? `?${query}` : ""}`);
    },

    listPullRequests(owner, repo, options = {}): Promise<GitHubPullRequest[]> {
      const params = new URLSearchParams();
      params.set("state", options.state || "open");
      if (options.perPage) params.set("per_page", String(options.perPage));

      return apiRequest<GitHubPullRequest[]>(
        `/repos/${owner}/${repo}/pulls?${params.toString()}`,
      );
    },

    getPullRequest(owner, repo, pullNumber): Promise<GitHubPullRequest> {
      return apiRequest<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    },

    async getPullRequestDiff(owner, repo, pullNumber): Promise<string> {
      const accessToken = await getAccessToken();

      const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.diff",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

      return response.text();
    },

    createIssue(owner, repo, options): Promise<GitHubIssue> {
      return apiRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    listIssues(owner, repo, options = {}): Promise<GitHubIssue[]> {
      const params = new URLSearchParams();
      params.set("state", options.state || "open");
      if (options.perPage) params.set("per_page", String(options.perPage));

      return apiRequest<GitHubIssue[]>(`/repos/${owner}/${repo}/issues?${params.toString()}`);
    },

    listCommits(owner, repo, options = {}): Promise<GitHubCommit[]> {
      const params = new URLSearchParams();
      if (options.sha) params.set("sha", options.sha);
      if (options.perPage) params.set("per_page", String(options.perPage));

      const query = params.toString();
      return apiRequest<GitHubCommit[]>(`/repos/${owner}/${repo}/commits${query ? `?${query}` : ""}`);
    },

    getUser(): Promise<{ login: string; name: string; email: string }> {
      return apiRequest("/user");
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;
