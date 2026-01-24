export type IssueState = "open" | "closed";

export type IssuePrefix = "ISSUE" | "TASK" | "PLAN";

export interface IssueMetadata {
  id: string;
  title: string;
  state: IssueState;
  labels: string[];
  milestone?: string;
  assignees: string[];
  created_at: string;
  updated_at: string;
}

export interface Issue {
  metadata: IssueMetadata;
  body: string;
  path: string;
}

export interface CreateIssueOptions {
  title: string;
  body?: string;
  labels?: string[];
  milestone?: string;
  assignees?: string[];
  prefix?: IssuePrefix;
}

export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  state?: IssueState;
  labels?: string[];
  milestone?: string | null;
  assignees?: string[];
}

export interface ListIssuesOptions {
  state?: IssueState;
  labels?: string[];
  milestone?: string;
  assignee?: string;
  prefix?: IssuePrefix;
  sortBy?: "created_at" | "updated_at" | "id";
  sortDirection?: "asc" | "desc";
  limit?: number;
}

export interface ListIssuesResult {
  issues: Issue[];
  total: number;
}
