import { LinearClient } from "@linear/sdk";

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
  teamId: string;
}

const QUERY = `
  query WorkflowStates($first: Int!, $after: String) {
    workflowStates(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        type
        position
        team { id }
      }
    }
  }
`;

interface RawResponse {
  workflowStates: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      name: string;
      type: string;
      position: number;
      team: { id: string };
    }>;
  };
}

export async function fetchAllWorkflowStates(client: LinearClient): Promise<WorkflowState[]> {
  const out: WorkflowState[] = [];
  let after: string | null = null;
  while (true) {
    const variables: Record<string, unknown> = { first: 100, after };
    const { data } = await client.client.rawRequest<RawResponse, Record<string, unknown>>(QUERY, variables);
    if (!data) throw new Error("Linear returned empty response (workflowStates)");
    for (const n of data.workflowStates.nodes) {
      out.push({
        id: n.id,
        name: n.name,
        type: n.type,
        position: n.position,
        teamId: n.team.id,
      });
    }
    if (!data.workflowStates.pageInfo.hasNextPage) break;
    after = data.workflowStates.pageInfo.endCursor;
  }
  return out;
}
