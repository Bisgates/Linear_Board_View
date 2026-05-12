export interface IssueRecord {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { id: string; name: string; type: string };
  priority: number;
  team: { id: string; key: string; name: string };
  assignee: { id: string; name: string } | null;
  labels: { id: string; name: string; color: string }[];
  project: { id: string; name: string } | null;
  cycle: { id: string; number: number; name: string | null } | null;
  parentId: string | null;
  childrenIds: string[];
}

export interface FetchResult {
  issues: IssueRecord[];
  pages: number;
}
