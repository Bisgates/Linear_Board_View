import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import { fetchAllIssues } from "../src/linear/fetchIssues.js";
import { fetchAllWorkflowStates } from "../src/linear/fetchWorkflowStates.js";

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("LINEAR_API_KEY not set. Copy .env.example to .env and fill it.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outFile = resolve(__dirname, "..", "public", "data", "issues.json");

const client = new LinearClient({ apiKey });
const start = Date.now();

let issues, pages, workflowStates;
try {
  const [issuesResult, ws] = await Promise.all([
    fetchAllIssues(client),
    fetchAllWorkflowStates(client),
  ]);
  ({ issues, pages } = issuesResult);
  workflowStates = ws;
} catch (err) {
  console.error("fetch failed:", err);
  process.exit(1);
}

const elapsedMs = Date.now() - start;

const snapshot = {
  fetchedAt: new Date().toISOString(),
  count: issues.length,
  pages,
  elapsedMs,
  issues,
  meta: { workflowStates },
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(snapshot, null, 2), "utf8");

console.log(`fetched ${issues.length} issues across ${pages} page(s) in ${elapsedMs}ms`);
console.log(`saved -> ${outFile}`);
