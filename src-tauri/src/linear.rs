// Linear GraphQL client — runs inside the Tauri backend.
//
// Why this exists: the frontend used to pull `@linear/sdk` directly. That SDK
// drags in Node-only shims (stream/http/url/https/crypto/zlib) that Vite has
// no choice but to externalise to stubs for the browser target. In a real
// browser those stubs are never hit, but the Tauri webview lazy-loads the SDK
// chunk and crashes on first init. We solved that here by issuing GraphQL
// requests from Rust — `reqwest` + `serde_json` — and returning `IssueRecord`
// shaped JSON to the frontend, which keeps the existing mutation / render
// surface untouched.
//
// All four operations (fetch issues, fetch workflow states, update issue,
// create comment) mirror the GraphQL queries in `src/linear/*.ts`. Keep them
// in sync if the wire format ever changes — the frontend's `IssueRecord` and
// `IssuePatch` types are the source of truth.

use std::sync::OnceLock;

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::fs;

use crate::{AppError, AppResult};

const LINEAR_ENDPOINT: &str = "https://api.linear.app/graphql";

// Single shared client for the process lifetime. `reqwest::Client` is already
// `Arc<Inner>` internally so cloning it for each request is essentially free;
// constructing one re-builds the TLS / connection pool which we don't want to
// do per request.
fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            // The Linear SDK uses no preset timeout; we pick 60s to keep the
            // dispatch loop from hanging forever if the network is dead.
            .timeout(std::time::Duration::from_secs(60))
            .user_agent("linear-board-tauri/0.23")
            .build()
            .expect("reqwest client build")
    })
}

// Token resolution mirrors `read_linear_api_key`: env first, then the on-disk
// file. Pulled into its own helper so the new GraphQL commands can use the
// same logic without round-tripping through Tauri IPC.
pub(crate) async fn resolve_api_key(app: &AppHandle) -> AppResult<String> {
    if let Ok(v) = std::env::var("LINEAR_API_KEY") {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let p = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?
        .join("linear_api_key.txt");
    match fs::read_to_string(&p).await {
        Ok(s) => {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                Err(AppError::Other(
                    "LINEAR_API_KEY not set (neither $LINEAR_API_KEY env nor ~/Library/Application Support/com.han.linearboard/linear_api_key.txt)".into(),
                ))
            } else {
                Ok(trimmed)
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AppError::Other(
            "LINEAR_API_KEY not set (neither $LINEAR_API_KEY env nor ~/Library/Application Support/com.han.linearboard/linear_api_key.txt)".into(),
        )),
        Err(e) => Err(AppError::from(e)),
    }
}

// One round-trip to Linear's GraphQL endpoint. Returns the `data` payload as
// a `serde_json::Value` — caller decides how to shape it.
//
// Linear's auth header is the bare token (no "Bearer " prefix). Confirmed
// against their docs and the SDK source.
async fn gql(app: &AppHandle, query: &str, variables: Value) -> AppResult<Value> {
    let key = resolve_api_key(app).await?;
    let body = json!({ "query": query, "variables": variables });
    let resp = http_client()
        .post(LINEAR_ENDPOINT)
        .header("Authorization", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("linear http: {e}")))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Other(format!("linear read body: {e}")))?;
    if !status.is_success() {
        return Err(AppError::Other(format!(
            "linear http {status}: {}",
            truncate(&text, 500)
        )));
    }
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Other(format!("linear json parse: {e} (body: {})", truncate(&text, 200))))?;
    if let Some(errs) = parsed.get("errors").and_then(|v| v.as_array()) {
        if !errs.is_empty() {
            // Surface first error message for readability; full list in debug.
            let first = errs
                .first()
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            return Err(AppError::Other(format!(
                "linear graphql error: {first} (all: {})",
                serde_json::to_string(errs).unwrap_or_default()
            )));
        }
    }
    parsed
        .get("data")
        .cloned()
        .ok_or_else(|| AppError::Other("linear response missing `data`".into()))
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

// ---------- IssueRecord wire format ----------
//
// These structs MUST match `src/linear/types.ts::IssueRecord` exactly — the
// frontend reads / writes these fields directly. Adding new fields is fine;
// renaming or removing existing ones breaks the board.

#[derive(Serialize, Clone)]
pub struct CommentRecord {
    pub id: String,
    pub body: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub user: Option<UserRef>,
}

#[derive(Serialize, Clone)]
pub struct UserRef {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct StateRef {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
}

#[derive(Serialize, Clone)]
pub struct TeamRef {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct LabelRef {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct CycleRef {
    pub id: String,
    pub number: i64,
    pub name: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct IssueRecord {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: StateRef,
    pub priority: f64, // Linear returns priority as number 0..4 — keep as f64 to mirror JS Number
    pub team: TeamRef,
    pub assignee: Option<UserRef>,
    pub labels: Vec<LabelRef>,
    pub project: Option<ProjectRef>,
    pub cycle: Option<CycleRef>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    #[serde(rename = "childrenIds")]
    pub children_ids: Vec<String>,
    pub comments: Vec<CommentRecord>,
}

// Shared GraphQL fragment-equivalent — we just paste the same selection set
// into both `issues` and `issueUpdate`. Keeping a single source-of-truth here
// guards against the two queries drifting apart.
const ISSUE_FIELDS: &str = r#"
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
"#;

fn parse_issue_node(node: &Value) -> AppResult<IssueRecord> {
    // Helper closure to surface a useful error when a required field is missing
    // rather than just `None` propagating silently.
    let s = |k: &str| -> AppResult<String> {
        node.get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::Other(format!("issue missing string field `{k}`")))
    };

    let state_v = node
        .get("state")
        .ok_or_else(|| AppError::Other("issue missing `state`".into()))?;
    let team_v = node
        .get("team")
        .ok_or_else(|| AppError::Other("issue missing `team`".into()))?;

    let labels = node
        .pointer("/labels/nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|n| {
                    Some(LabelRef {
                        id: n.get("id")?.as_str()?.to_string(),
                        name: n.get("name")?.as_str()?.to_string(),
                        color: n.get("color")?.as_str()?.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let children_ids = node
        .pointer("/children/nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let comments = node
        .pointer("/comments/nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    Some(CommentRecord {
                        id: c.get("id")?.as_str()?.to_string(),
                        body: c.get("body")?.as_str()?.to_string(),
                        created_at: c.get("createdAt")?.as_str()?.to_string(),
                        user: c
                            .get("user")
                            .and_then(|u| {
                                if u.is_null() {
                                    None
                                } else {
                                    Some(UserRef {
                                        id: u.get("id")?.as_str()?.to_string(),
                                        name: u.get("name")?.as_str()?.to_string(),
                                    })
                                }
                            }),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(IssueRecord {
        id: s("id")?,
        identifier: s("identifier")?,
        title: s("title")?,
        description: node
            .get("description")
            .and_then(|v| if v.is_null() { None } else { v.as_str() })
            .map(|s| s.to_string()),
        state: StateRef {
            id: state_v.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            name: state_v.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            type_: state_v.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        },
        priority: node.get("priority").and_then(|v| v.as_f64()).unwrap_or(0.0),
        team: TeamRef {
            id: team_v.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            key: team_v.get("key").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            name: team_v.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        },
        assignee: node.get("assignee").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(UserRef {
                    id: v.get("id")?.as_str()?.to_string(),
                    name: v.get("name")?.as_str()?.to_string(),
                })
            }
        }),
        labels,
        project: node.get("project").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(ProjectRef {
                    id: v.get("id")?.as_str()?.to_string(),
                    name: v.get("name")?.as_str()?.to_string(),
                })
            }
        }),
        cycle: node.get("cycle").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(CycleRef {
                    id: v.get("id")?.as_str()?.to_string(),
                    number: v.get("number")?.as_i64()?,
                    name: v.get("name").and_then(|n| if n.is_null() { None } else { n.as_str().map(|s| s.to_string()) }),
                })
            }
        }),
        parent_id: node
            .pointer("/parent/id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        children_ids,
        comments,
    })
}

// ---------- Workflow states ----------

#[derive(Serialize, Clone)]
pub struct WorkflowState {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub position: f64,
    #[serde(rename = "teamId")]
    pub team_id: String,
}

// ---------- IssuePatch -> GraphQL input ----------
//
// `IssuePatch` from `src/linear/updateIssue.ts` is the source of truth.
// We accept the patch as raw JSON and rebuild `IssueUpdateInput` defensively:
// only forward the keys the SDK accepts, and only when present.
fn build_issue_update_input(patch: &Value) -> Value {
    let mut out = serde_json::Map::new();
    let obj = match patch.as_object() {
        Some(o) => o,
        None => return Value::Object(out),
    };
    for key in [
        "title",
        "description",
        "stateId",
        "priority",
        "assigneeId",
        "projectId",
        "cycleId",
        "labelIds",
    ] {
        if let Some(v) = obj.get(key) {
            out.insert(key.to_string(), v.clone());
        }
    }
    Value::Object(out)
}

// ---------- Tauri commands ----------

#[derive(Serialize)]
pub struct FetchResult {
    pub issues: Vec<IssueRecord>,
    pub pages: i32,
}

const ISSUES_QUERY: &str = r#"
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
"#;

#[tauri::command]
pub async fn linear_fetch_all_issues(app: AppHandle) -> AppResult<FetchResult> {
    let mut after: Option<String> = None;
    let mut pages: i32 = 0;
    let mut issues: Vec<IssueRecord> = Vec::new();
    let state_types = json!(["backlog", "unstarted", "started"]);
    loop {
        pages += 1;
        let variables = json!({
            "first": 50,
            "after": after,
            "stateTypes": state_types,
        });
        let data = gql(&app, ISSUES_QUERY, variables).await?;
        let nodes = data
            .pointer("/issues/nodes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| AppError::Other("issues query: missing nodes".into()))?
            .clone();
        for n in &nodes {
            issues.push(parse_issue_node(n)?);
        }
        let has_next = data
            .pointer("/issues/pageInfo/hasNextPage")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_next {
            break;
        }
        after = data
            .pointer("/issues/pageInfo/endCursor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    Ok(FetchResult { issues, pages })
}

const WORKFLOW_QUERY: &str = r#"
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
"#;

#[tauri::command]
pub async fn linear_fetch_workflow_states(app: AppHandle) -> AppResult<Vec<WorkflowState>> {
    let mut out: Vec<WorkflowState> = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let variables = json!({ "first": 100, "after": after });
        let data = gql(&app, WORKFLOW_QUERY, variables).await?;
        let nodes = data
            .pointer("/workflowStates/nodes")
            .and_then(|v| v.as_array())
            .ok_or_else(|| AppError::Other("workflowStates: missing nodes".into()))?
            .clone();
        for n in &nodes {
            out.push(WorkflowState {
                id: n.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: n.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                type_: n.get("type").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                position: n.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0),
                team_id: n
                    .pointer("/team/id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
            });
        }
        let has_next = data
            .pointer("/workflowStates/pageInfo/hasNextPage")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_next {
            break;
        }
        after = data
            .pointer("/workflowStates/pageInfo/endCursor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    Ok(out)
}

fn update_query() -> String {
    format!(
        r#"
  mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {{
    issueUpdate(id: $id, input: $input) {{
      success
      issue {{ {ISSUE_FIELDS} }}
    }}
  }}
"#
    )
}

#[tauri::command]
pub async fn linear_update_issue(
    app: AppHandle,
    id: String,
    patch: Value,
) -> AppResult<IssueRecord> {
    let input = build_issue_update_input(&patch);
    let variables = json!({ "id": id, "input": input });
    let data = gql(&app, &update_query(), variables).await?;
    let success = data
        .pointer("/issueUpdate/success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !success {
        return Err(AppError::Other("issueUpdate.success === false".into()));
    }
    let node = data
        .pointer("/issueUpdate/issue")
        .ok_or_else(|| AppError::Other("issueUpdate: missing issue".into()))?;
    parse_issue_node(node)
}

const CREATE_COMMENT_MUT: &str = r#"
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id body createdAt user { id name } }
    }
  }
"#;

#[derive(Serialize)]
pub struct CreatedComment {
    pub id: String,
    pub body: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub user: Option<UserRef>,
}

#[tauri::command]
pub async fn linear_create_issue_comment(
    app: AppHandle,
    issue_id: String,
    body: String,
) -> AppResult<CreatedComment> {
    let variables = json!({
        "input": { "issueId": issue_id, "body": body }
    });
    let data = gql(&app, CREATE_COMMENT_MUT, variables).await?;
    let success = data
        .pointer("/commentCreate/success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !success {
        return Err(AppError::Other("commentCreate.success === false".into()));
    }
    let c = data
        .pointer("/commentCreate/comment")
        .ok_or_else(|| AppError::Other("commentCreate: missing comment".into()))?;
    Ok(CreatedComment {
        id: c.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        body: c.get("body").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        created_at: c
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        user: c.get("user").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(UserRef {
                    id: v.get("id")?.as_str()?.to_string(),
                    name: v.get("name")?.as_str()?.to_string(),
                })
            }
        }),
    })
}

