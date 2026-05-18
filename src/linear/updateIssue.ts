// Patch wire format for issue updates. The previous implementation here used
// `@linear/sdk` from the Node side; the Tauri-only runtime issues mutations
// from Rust (`linear_update_issue` command), but the patch shape is still the
// canonical contract for both `App.tsx#mutate` and the Rust side.

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
