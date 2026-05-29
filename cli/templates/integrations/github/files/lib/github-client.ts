/**
 * GitHub API Client
 *
 * Provides a type-safe interface to GitHub API operations.
 */

import { getValidToken } from "./oauth.ts";

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  type: string;
  html_url: string;
  avatar_url: string;
  company: string | null;
  blog: string;
  location: string | null;
  email: string | null;
  bio: string | null;
  twitter_username: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

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

export interface GitHubMergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

/**
 * GitHub OAuth provider configuration
 */
export const githubOAuthProvider = {
  name: "github",
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  clientId: getEnv("GITHUB_CLIENT_ID") ?? "",
  clientSecret: getEnv("GITHUB_CLIENT_SECRET") ?? "",
  scopes: ["repo", "read:user", "read:org"],
  callbackPath: "/api/auth/github/callback",
};

export function createGitHubClient(userId: string): {
  listRepos(options?: {
    sort?: "created" | "updated" | "pushed" | "full_name";
    perPage?: number;
    type?: "all" | "owner" | "public" | "private" | "member";
  }): Promise<GitHubRepo[]>;
  getRepo(owner: string, repo: string): Promise<GitHubRepo>;
  listPullRequests(
    owner: string,
    repo: string,
    options?: { state?: "open" | "closed" | "all"; perPage?: number },
  ): Promise<GitHubPullRequest[]>;
  getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<GitHubPullRequest>;
  getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string>;
  createIssue(
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    },
  ): Promise<GitHubIssue>;
  getIssue(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssue>;
  updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    options: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: string[];
      assignees?: string[];
    },
  ): Promise<GitHubIssue>;
  addIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<
    {
      id: number;
      html_url: string;
      body: string;
      user: { login: string };
      created_at: string;
    }
  >;
  listIssues(
    owner: string,
    repo: string,
    options?: { state?: "open" | "closed" | "all"; perPage?: number },
  ): Promise<GitHubIssue[]>;
  listCommits(
    owner: string,
    repo: string,
    options?: { sha?: string; path?: string; perPage?: number },
  ): Promise<GitHubCommit[]>;
  createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string;
      body?: string;
      head: string;
      base: string;
      draft?: boolean;
    },
  ): Promise<GitHubPullRequest>;
  mergePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    options?: {
      commit_title?: string;
      commit_message?: string;
      merge_method?: "merge" | "squash" | "rebase";
    },
  ): Promise<GitHubMergeResult>;
  getUser(): Promise<{ login: string; name: string; email: string }>;
  getUserByUsername(username: string): Promise<GitHubUser>;
} {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(githubOAuthProvider, userId, "github");
    if (!token) {
      throw new Error(
        "GitHub not connected. Please connect your GitHub account first.",
      );
    }
    return token;
  }

  async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
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

    return response.json() as Promise<T>;
  }

  async function apiTextRequest(
    endpoint: string,
    accept: string,
  ): Promise<string> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    return response.text();
  }

  function toQueryString(params: URLSearchParams): string {
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  return {
    listRepos(options = {}): Promise<GitHubRepo[]> {
      const params = new URLSearchParams();
      if (options.sort) params.set("sort", options.sort);
      if (options.perPage) params.set("per_page", String(options.perPage));
      if (options.type) params.set("type", options.type);

      return apiRequest<GitHubRepo[]>(`/user/repos${toQueryString(params)}`);
    },

    getRepo(owner, repo): Promise<GitHubRepo> {
      return apiRequest<GitHubRepo>(`/repos/${owner}/${repo}`);
    },

    listPullRequests(owner, repo, options = {}): Promise<GitHubPullRequest[]> {
      const params = new URLSearchParams();
      params.set("state", options.state ?? "open");
      if (options.perPage) params.set("per_page", String(options.perPage));

      return apiRequest<GitHubPullRequest[]>(
        `/repos/${owner}/${repo}/pulls${toQueryString(params)}`,
      );
    },

    getPullRequest(owner, repo, pullNumber): Promise<GitHubPullRequest> {
      return apiRequest<GitHubPullRequest>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}`,
      );
    },

    getPullRequestDiff(owner, repo, pullNumber): Promise<string> {
      return apiTextRequest(
        `/repos/${owner}/${repo}/pulls/${pullNumber}`,
        "application/vnd.github.diff",
      );
    },

    createIssue(owner, repo, options): Promise<GitHubIssue> {
      return apiRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    getIssue(owner, repo, issueNumber): Promise<GitHubIssue> {
      return apiRequest<GitHubIssue>(
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
      );
    },

    updateIssue(owner, repo, issueNumber, options): Promise<GitHubIssue> {
      return apiRequest<GitHubIssue>(
        `/repos/${owner}/${repo}/issues/${issueNumber}`,
        {
          method: "PATCH",
          body: JSON.stringify(options),
        },
      );
    },

    addIssueComment(owner, repo, issueNumber, body) {
      return apiRequest(
        `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        },
      );
    },

    listIssues(owner, repo, options = {}): Promise<GitHubIssue[]> {
      const params = new URLSearchParams();
      params.set("state", options.state ?? "open");
      if (options.perPage) params.set("per_page", String(options.perPage));

      return apiRequest<GitHubIssue[]>(
        `/repos/${owner}/${repo}/issues${toQueryString(params)}`,
      );
    },

    listCommits(owner, repo, options = {}): Promise<GitHubCommit[]> {
      const params = new URLSearchParams();
      if (options.sha) params.set("sha", options.sha);
      if (options.path) params.set("path", options.path);
      if (options.perPage) params.set("per_page", String(options.perPage));

      return apiRequest<GitHubCommit[]>(
        `/repos/${owner}/${repo}/commits${toQueryString(params)}`,
      );
    },

    createPullRequest(owner, repo, options): Promise<GitHubPullRequest> {
      return apiRequest<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    mergePullRequest(owner, repo, pullNumber, options = {}): Promise<GitHubMergeResult> {
      return apiRequest<GitHubMergeResult>(
        `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
        {
          method: "PUT",
          body: JSON.stringify(options),
        },
      );
    },

    getUser(): Promise<{ login: string; name: string; email: string }> {
      return apiRequest("/user");
    },

    getUserByUsername(username): Promise<GitHubUser> {
      return apiRequest<GitHubUser>(`/users/${encodeURIComponent(username)}`);
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;
