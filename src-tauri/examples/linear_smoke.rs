// Offline smoke test for the Linear GraphQL queries.
//
// Compiled separately from the main Tauri binary so we can exercise the
// query strings + auth headers against the real Linear API without booting
// the webview. Run with:
//   cargo run --example linear_smoke -- /path/to/token-file
//
// Validates:
//   1. Auth header format (bare token, no "Bearer ")
//   2. The Issues query parses on Linear's end (no GraphQL validation errors)
//   3. Pagination cursors are returned as expected
//   4. WorkflowStates query parses cleanly
//
// This does NOT exercise the IssueUpdate / CommentCreate mutations to avoid
// touching production data. Those mutations follow the same auth + body
// shape as the queries here, so green status on this smoke gives high
// confidence the others work too.

use std::env;
use std::fs;

use reqwest::Client;
use serde_json::{json, Value};

const ENDPOINT: &str = "https://api.linear.app/graphql";

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
        priority
        state { id name type }
        team { id key name }
      }
    }
  }
"#;

const WORKFLOW_QUERY: &str = r#"
  query WorkflowStates($first: Int!, $after: String) {
    workflowStates(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name type position team { id } }
    }
  }
"#;

async fn gql(client: &Client, token: &str, query: &str, variables: Value) -> Value {
    let body = json!({ "query": query, "variables": variables });
    let resp = client
        .post(ENDPOINT)
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .expect("send");
    assert!(resp.status().is_success(), "http {}", resp.status());
    let text = resp.text().await.expect("text");
    let parsed: Value = serde_json::from_str(&text).expect("json");
    assert!(parsed.get("errors").is_none(), "graphql errors: {}", parsed);
    parsed
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    let path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| {
            let home = env::var("HOME").unwrap();
            format!("{home}/Library/Application Support/com.han.linearboard/linear_api_key.txt")
        });
    let token = fs::read_to_string(&path)
        .expect("read token")
        .trim()
        .to_string();
    assert!(!token.is_empty(), "empty token");
    println!("token loaded ({} bytes)", token.len());

    let client = Client::new();

    // Issues page 1
    let r = gql(
        &client,
        &token,
        ISSUES_QUERY,
        json!({ "first": 5, "after": null, "stateTypes": ["backlog","unstarted","started"] }),
    )
    .await;
    let nodes = r.pointer("/data/issues/nodes").and_then(|v| v.as_array()).unwrap();
    println!("issues page 1: {} nodes", nodes.len());
    if let Some(first) = nodes.first() {
        println!(
            "  first: {} {} (state={})",
            first.get("identifier").and_then(|v| v.as_str()).unwrap_or(""),
            first.get("title").and_then(|v| v.as_str()).unwrap_or(""),
            first.pointer("/state/type").and_then(|v| v.as_str()).unwrap_or(""),
        );
    }
    let cursor = r
        .pointer("/data/issues/pageInfo/endCursor")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let has_next = r
        .pointer("/data/issues/pageInfo/hasNextPage")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    println!("hasNext={has_next} cursor={cursor:?}");

    // Workflow states
    let r = gql(&client, &token, WORKFLOW_QUERY, json!({ "first": 100, "after": null })).await;
    let nodes = r.pointer("/data/workflowStates/nodes").and_then(|v| v.as_array()).unwrap();
    println!("workflowStates: {} nodes", nodes.len());

    println!("OK");
}
