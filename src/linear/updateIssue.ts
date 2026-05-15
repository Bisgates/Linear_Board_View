import { LinearClient } from "@linear/sdk";
import type { IssueRecord } from "./types.js";

export interface IssuePatch {
  title?: string;
  description?: string;
  stateId?: string;
  priority?: number;
  assigneeId?: string | null;
  projectId?: string | null;
  cycleId?: string | null;
  labelIds?: string[];
}

const UPDATE_QUERY = `
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
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

interface RawIssueResponse {
  issueUpdate: {
    success: boolean;
    issue: {
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
    };
  };
}

function toRecord(node: RawIssueResponse["issueUpdate"]["issue"]): IssueRecord {
  return {
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
  };
}

export async function updateIssue(
  client: LinearClient,
  id: string,
  patch: IssuePatch,
): Promise<IssueRecord> {
  const input: Record<string, unknown> = {};
  if (patch.title !== undefined) input.title = patch.title;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.stateId !== undefined) input.stateId = patch.stateId;
  if (patch.priority !== undefined) input.priority = patch.priority;
  if (patch.assigneeId !== undefined) input.assigneeId = patch.assigneeId;
  if (patch.projectId !== undefined) input.projectId = patch.projectId;
  if (patch.cycleId !== undefined) input.cycleId = patch.cycleId;
  if (patch.labelIds !== undefined) input.labelIds = patch.labelIds;

  const variables: Record<string, unknown> = { id, input };
  const { data } = await client.client.rawRequest<RawIssueResponse, Record<string, unknown>>(
    UPDATE_QUERY,
    variables,
  );
  if (!data) throw new Error("Linear returned empty response");
  if (!data.issueUpdate.success) throw new Error("issueUpdate.success === false");
  return toRecord(data.issueUpdate.issue);
}
