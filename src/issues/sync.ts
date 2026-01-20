/**
 * GitHub Issues sync - Bi-directional sync between local files and GitHub Issues
 *
 * Sync local markdown files to/from GitHub Issues API.
 * Maps between our file format and GitHub's native issue format.
 */

import { logger } from "#veryfront/utils"
import type { IssueMetadata, IssueFile, IssueType } from "./types.ts"
import { listAllResources, readResource, createResource, updateResource } from "./core.ts"

const LOG_PREFIX = "[IssuesSync]"

/**
 * GitHub Issue API response
 * https://docs.github.com/en/rest/issues/issues
 */
export interface GitHubIssue {
  number: number
  title: string
  state: "open" | "closed"
  body: string | null
  labels: Array<{ name: string }>
  milestone: { title: string } | null
  assignees: Array<{ login: string }>
  created_at: string
  updated_at: string
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  owner: string
  repo: string
  token: string
}

/**
 * Sync statistics
 */
export interface SyncStats {
  pulled: number
  pushed: number
  updated: number
  conflicts: number
  errors: number
}

/**
 * GitHub API client for issues
 */
class GitHubIssuesClient {
  private baseUrl = "https://api.github.com"

  constructor(private config: SyncConfig) {}

  /**
   * List all issues from GitHub
   */
  async listIssues(state: "open" | "closed" | "all" = "all"): Promise<GitHubIssue[]> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/issues?state=${state}&per_page=100`

    logger.debug(`${LOG_PREFIX} Fetching issues from GitHub`, { owner: this.config.owner, repo: this.config.repo })

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "veryfront-renderer",
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * Get a single issue by number
   */
  async getIssue(number: number): Promise<GitHubIssue> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/${number}`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "veryfront-renderer",
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * Create a new issue on GitHub
   */
  async createIssue(data: {
    title: string
    body: string
    labels?: string[]
    milestone?: string
    assignees?: string[]
  }): Promise<GitHubIssue> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/issues`

    logger.debug(`${LOG_PREFIX} Creating issue on GitHub`, { title: data.title })

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "veryfront-renderer",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * Update an existing issue on GitHub
   */
  async updateIssue(number: number, data: {
    title?: string
    body?: string
    state?: "open" | "closed"
    labels?: string[]
    milestone?: string
    assignees?: string[]
  }): Promise<GitHubIssue> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/${number}`

    logger.debug(`${LOG_PREFIX} Updating issue on GitHub`, { number })

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "veryfront-renderer",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  }
}

/**
 * Extract type from labels
 */
function getTypeFromLabels(labels: string[]): IssueType {
  if (labels.includes("type:plan")) return "plan"
  if (labels.includes("type:milestone")) return "milestone"
  return "issue"
}

/**
 * Convert GitHub issue to our create options format
 */
function fromGitHubIssue(ghIssue: GitHubIssue): {
  title: string
  type: IssueType
  labels: string[]
  milestone?: string
  assignees: string[]
  content: string
  number: number
  state: "open" | "closed"
  created_at: string
  updated_at: string
} {
  const labels = ghIssue.labels.map(l => l.name)
  const type = getTypeFromLabels(labels)

  return {
    title: ghIssue.title,
    type,
    labels,
    milestone: ghIssue.milestone?.title,
    assignees: ghIssue.assignees.map(a => a.login),
    content: ghIssue.body || `# ${ghIssue.title}\n\n[No description]`,
    number: ghIssue.number,
    state: ghIssue.state,
    created_at: ghIssue.created_at,
    updated_at: ghIssue.updated_at,
  }
}

/**
 * Convert our issue to GitHub issue format
 */
function toGitHubIssue(issue: IssueFile): {
  title: string
  body: string
  state: "open" | "closed"
  labels: string[]
  assignees: string[]
} {
  return {
    title: issue.metadata.title,
    body: issue.content,
    state: issue.metadata.state,
    labels: issue.metadata.labels,
    assignees: issue.metadata.assignees,
  }
}

/**
 * Pull issues from GitHub to local files
 */
export async function pullFromGitHub(
  config: SyncConfig,
  projectDir: string,
): Promise<SyncStats> {
  const client = new GitHubIssuesClient(config)
  const stats: SyncStats = {
    pulled: 0,
    pushed: 0,
    updated: 0,
    conflicts: 0,
    errors: 0,
  }

  logger.info(`${LOG_PREFIX} Pulling issues from GitHub`, {
    owner: config.owner,
    repo: config.repo
  })

  try {
    // Fetch all issues from GitHub
    const ghIssues = await client.listIssues("all")

    // Get existing local issues
    const localIssues = await listAllResources(projectDir)
    const localByNumber = new Map(
      localIssues
        .filter(i => i.metadata.number)
        .map(i => [i.metadata.number!, i])
    )

    // Process each GitHub issue
    for (const ghIssue of ghIssues) {
      try {
        const existing = localByNumber.get(ghIssue.number)
        const ghData = fromGitHubIssue(ghIssue)

        if (existing) {
          // Update existing issue
          await updateResource({
            id: existing.metadata.id,
            title: ghData.title,
            state: ghData.state,
            labels: ghData.labels,
            milestone: ghData.milestone,
            assignees: ghData.assignees,
            content: ghData.content,
          }, projectDir)
          stats.updated++
        } else {
          // Create new issue
          await createResource({
            title: ghData.title,
            type: ghData.type,
            labels: ghData.labels,
            milestone: ghData.milestone,
            assignees: ghData.assignees,
            content: ghData.content,
          }, projectDir)
          stats.pulled++
        }
      } catch (error) {
        logger.error(`${LOG_PREFIX} Failed to sync issue #${ghIssue.number}`, error)
        stats.errors++
      }
    }

    logger.info(`${LOG_PREFIX} Pull complete`, stats)
  } catch (error) {
    logger.error(`${LOG_PREFIX} Pull failed`, error)
    throw error
  }

  return stats
}

/**
 * Push local issues to GitHub
 */
export async function pushToGitHub(
  config: SyncConfig,
  projectDir: string,
): Promise<SyncStats> {
  const client = new GitHubIssuesClient(config)
  const stats: SyncStats = {
    pulled: 0,
    pushed: 0,
    updated: 0,
    conflicts: 0,
    errors: 0,
  }

  logger.info(`${LOG_PREFIX} Pushing issues to GitHub`, {
    owner: config.owner,
    repo: config.repo
  })

  try {
    // Get all local issues
    const localIssues = await listAllResources(projectDir)

    // Process each local issue
    for (const issue of localIssues) {
      try {
        const ghData = toGitHubIssue(issue)

        if (issue.metadata.number) {
          // Update existing issue on GitHub
          await client.updateIssue(issue.metadata.number, ghData)
          stats.updated++
        } else {
          // Create new issue on GitHub
          const created = await client.createIssue(ghData)

          // Update local file with GitHub issue number
          await updateResource({
            id: issue.metadata.id,
            number: created.number,
          }, projectDir)

          stats.pushed++
        }
      } catch (error) {
        logger.error(`${LOG_PREFIX} Failed to push issue ${issue.metadata.id}`, error)
        stats.errors++
      }
    }

    logger.info(`${LOG_PREFIX} Push complete`, stats)
  } catch (error) {
    logger.error(`${LOG_PREFIX} Push failed`, error)
    throw error
  }

  return stats
}

/**
 * Bi-directional sync (pull then push)
 */
export async function sync(
  config: SyncConfig,
  projectDir: string,
): Promise<SyncStats> {
  logger.info(`${LOG_PREFIX} Starting bi-directional sync`)

  // Pull first to get latest from GitHub
  const pullStats = await pullFromGitHub(config, projectDir)

  // Then push local changes
  const pushStats = await pushToGitHub(config, projectDir)

  return {
    pulled: pullStats.pulled,
    pushed: pushStats.pushed,
    updated: pullStats.updated + pushStats.updated,
    conflicts: pullStats.conflicts + pushStats.conflicts,
    errors: pullStats.errors + pushStats.errors,
  }
}
