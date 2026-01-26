import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }

  return undefined;
}

const BITBUCKET_API_BASE = "https://api.bitbucket.org/2.0";

export interface BitbucketUser {
  uuid: string;
  username: string;
  display_name: string;
  account_id: string;
  links: {
    avatar: { href: string };
    html: { href: string };
  };
}

export interface Repository {
  uuid: string;
  name: string;
  full_name: string;
  description: string | null;
  is_private: boolean;
  mainbranch: { name: string } | null;
  language: string;
  size: number;
  updated_on: string;
  created_on: string;
  links: {
    html: { href: string };
    clone: Array<{ href: string; name: string }>;
  };
  owner: {
    username: string;
    display_name: string;
  };
}

export interface PullRequest {
  id: number;
  title: string;
  description: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  author: {
    username: string;
    display_name: string;
  };
  created_on: string;
  updated_on: string;
  source: {
    branch: { name: string };
    repository: { full_name: string };
  };
  destination: {
    branch: { name: string };
    repository: { full_name: string };
  };
  links: {
    html: { href: string };
    diff: { href: string };
  };
  comment_count: number;
  task_count: number;
}

export interface Issue {
  id: number;
  title: string;
  content: {
    raw: string;
  } | null;
  state: "new" | "open" | "resolved" | "on hold" | "invalid" | "duplicate" | "wontfix" | "closed";
  kind: "bug" | "enhancement" | "proposal" | "task";
  priority: "trivial" | "minor" | "major" | "critical" | "blocker";
  created_on: string;
  updated_on: string;
  reporter: {
    username: string;
    display_name: string;
  };
  assignee: {
    username: string;
    display_name: string;
  } | null;
  links: {
    html: { href: string };
  };
}

/**
 * Bitbucket OAuth provider configuration
 */
export const bitbucketOAuthProvider = {
  name: "bitbucket",
  authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
  tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
  clientId: getEnv("BITBUCKET_CLIENT_ID") ?? "",
  clientSecret: getEnv("BITBUCKET_CLIENT_SECRET") ?? "",
  scopes: ["repository", "pullrequest", "issue", "account"],
  callbackPath: "/api/auth/bitbucket/callback",
};

function buildQuery(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Create a Bitbucket client for a specific user
 */
export function createBitbucketClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(bitbucketOAuthProvider, userId, "bitbucket");
    if (!token) {
      throw new Error("Bitbucket not connected. Please connect your Bitbucket account first.");
    }
    return token;
  }

  async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${BITBUCKET_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bitbucket API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  return {
    /**
     * Get authenticated user
     */
    getCurrentUser(): Promise<BitbucketUser> {
      return apiRequest("/user");
    },

    /**
     * List user's repositories
     */
    async listRepositories(
      options: {
        role?: "owner" | "contributor" | "member";
        perPage?: number;
      } = {},
    ): Promise<Repository[]> {
      const params = new URLSearchParams();
      if (options.role) params.set("role", options.role);
      if (options.perPage) params.set("pagelen", String(options.perPage));

      const response = await apiRequest<{ values: Repository[] }>(
        `/repositories${buildQuery(params)}`,
      );
      return response.values;
    },

    /**
     * Get repository details
     */
    getRepository(workspace: string, repoSlug: string): Promise<Repository> {
      return apiRequest(`/repositories/${workspace}/${repoSlug}`);
    },

    /**
     * List pull requests for a repository
     */
    async listPullRequests(
      workspace: string,
      repoSlug: string,
      options: {
        state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
        perPage?: number;
      } = {},
    ): Promise<PullRequest[]> {
      const params = new URLSearchParams();
      if (options.state) params.set("state", options.state);
      if (options.perPage) params.set("pagelen", String(options.perPage));

      const response = await apiRequest<{ values: PullRequest[] }>(
        `/repositories/${workspace}/${repoSlug}/pullrequests${buildQuery(params)}`,
      );
      return response.values;
    },

    /**
     * Get a single pull request
     */
    getPullRequest(
      workspace: string,
      repoSlug: string,
      pullRequestId: number,
    ): Promise<PullRequest> {
      return apiRequest(`/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}`);
    },

    /**
     * Create a pull request
     */
    createPullRequest(
      workspace: string,
      repoSlug: string,
      options: {
        title: string;
        description?: string;
        sourceBranch: string;
        destinationBranch: string;
        closeSourceBranch?: boolean;
      },
    ): Promise<PullRequest> {
      return apiRequest(`/repositories/${workspace}/${repoSlug}/pullrequests`, {
        method: "POST",
        body: JSON.stringify({
          title: options.title,
          description: options.description,
          source: { branch: { name: options.sourceBranch } },
          destination: { branch: { name: options.destinationBranch } },
          close_source_branch: options.closeSourceBranch,
        }),
      });
    },

    /**
     * List issues for a repository
     */
    async listIssues(
      workspace: string,
      repoSlug: string,
      options: {
        state?:
          | "new"
          | "open"
          | "resolved"
          | "on hold"
          | "invalid"
          | "duplicate"
          | "wontfix"
          | "closed";
        kind?: "bug" | "enhancement" | "proposal" | "task";
        priority?: "trivial" | "minor" | "major" | "critical" | "blocker";
        perPage?: number;
      } = {},
    ): Promise<Issue[]> {
      const params = new URLSearchParams();
      if (options.state) params.set("q", `state="${options.state}"`);
      if (options.kind) params.set("kind", options.kind);
      if (options.priority) params.set("priority", options.priority);
      if (options.perPage) params.set("pagelen", String(options.perPage));

      const response = await apiRequest<{ values: Issue[] }>(
        `/repositories/${workspace}/${repoSlug}/issues${buildQuery(params)}`,
      );
      return response.values;
    },

    /**
     * Create an issue
     */
    createIssue(
      workspace: string,
      repoSlug: string,
      options: {
        title: string;
        description?: string;
        kind?: "bug" | "enhancement" | "proposal" | "task";
        priority?: "trivial" | "minor" | "major" | "critical" | "blocker";
      },
    ): Promise<Issue> {
      return apiRequest(`/repositories/${workspace}/${repoSlug}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title: options.title,
          content: options.description ? { raw: options.description } : undefined,
          kind: options.kind ?? "bug",
          priority: options.priority ?? "major",
        }),
      });
    },
  };
}

export type BitbucketClient = ReturnType<typeof createBitbucketClient>;
