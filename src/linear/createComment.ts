import { LinearClient } from "@linear/sdk";
import type { CommentRecord } from "./types.js";

const CREATE_COMMENT = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id body createdAt user { id name } }
    }
  }
`;

interface RawCreateResponse {
  commentCreate: {
    success: boolean;
    comment: {
      id: string;
      body: string;
      createdAt: string;
      user: { id: string; name: string } | null;
    };
  };
}

export async function createIssueComment(
  client: LinearClient,
  issueId: string,
  body: string,
): Promise<CommentRecord> {
  const { data } = await client.client.rawRequest<RawCreateResponse, Record<string, unknown>>(
    CREATE_COMMENT,
    { input: { issueId, body } },
  );
  if (!data || !data.commentCreate.success) {
    throw new Error("commentCreate failed");
  }
  return data.commentCreate.comment;
}
