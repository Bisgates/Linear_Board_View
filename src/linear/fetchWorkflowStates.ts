// Workflow state wire format. The Rust side (`linear_fetch_workflow_states`)
// serialises into this exact shape so the frontend can render the
// state-picker — including states (e.g. "Done") whose issues do not appear in
// the open-only snapshot.

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
  teamId: string;
}
