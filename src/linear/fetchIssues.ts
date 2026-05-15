import { LinearClient } from "@linear/sdk";
import type { FetchResult, IssueRecord } from "./types.js";

const ISSUES_QUERY = `
  query Issues($first: Int!, $after: String, $stateTypes: [String!]!) {
    issues(
      first: $first
      after: $after
      filter: { state: { type: { in: $stateTypes } } }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        description
        priority
        state { id name type }
        team { id key name }
        assignee { id name }
        labels { nodes { id name color } }
        project { id name }
        cycle { id number name }
        parent { id }
        children { nodes { id } }
        comments(first: 50, orderBy: createdAt) {
          nodes { id body createdAt user { id name } }
        }
      }
    }
  }
`;

interface RawIssuesResponse {
  issues: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      identifier: string;
      title: string;
      description: string | null;
      priority: number;
      state: { id: string; name: string; type: string };
      team: { id: string; key: string; name: string };
      assignee: { id: string; name: string } | null;
      labels: { nodes: { id: string; name: string; color: string }[] };
      project: { id: string; name: string } | null;
      cycle: { id: string; number: number; name: string | null } | null;
      parent: { id: string } | null;
      children: { nodes: { id: string }[] };
      comments: {
        nodes: { id: string; body: string; createdAt: string; user: { id: string; name: string } | null }[];
      };
    }>;
  };
}

const OPEN_STATE_TYPES = ["backlog", "unstarted", "started"];

export async function fetchAllIssues(client: LinearClient): Promise<FetchResult> {
  const records: IssueRecord[] = [];
  let after: string | null = null;
  let pages = 0;

  while (true) {
    pages++;
    const variables: Record<string, unknown> = {
      first: 50,
      after,
      stateTypes: OPEN_STATE_TYPES,
    };
    const { data } = await client.client.rawRequest<RawIssuesResponse, Record<string, unknown>>(
      ISSUES_QUERY,
      variables,
    );

    if (!data) throw new Error("Linear returned empty response");

    for (const node of data.issues.nodes) {
      records.push({
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        description: node.description,
        state: node.state,
        priority: node.priority,
        team: node.team,
        assignee: node.assignee,
        labels: node.labels.nodes,
        project: node.project,
        cycle: node.cycle,
        parentId: node.parent?.id ?? null,
        childrenIds: node.children.nodes.map((c) => c.id),
        comments: node.comments.nodes.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt,
          user: c.user,
        })),
      });
    }

    if (!data.issues.pageInfo.hasNextPage) break;
    after = data.issues.pageInfo.endCursor;
  }

  return { issues: records, pages };
}
