#!/usr/bin/env node
/**
 * Files the 120-issue contributor batch for keylease-gateway.
 *
 *   node scripts/create-issues.mjs --dry-run   # print the batch, create nothing
 *   node scripts/create-issues.mjs             # file every issue that is missing
 *   node scripts/create-issues.mjs --repo owner/name
 *
 * Re-running is safe: titles that already exist (open or closed) are skipped,
 * so a failed run can simply be started again. Requires an authenticated `gh`
 * with issue write access to the target repository.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cliIssues } from "./issues/cli.mjs";
import { ciIssues } from "./issues/ci.mjs";
import { contractIssues } from "./issues/contract.mjs";
import { docsIssues } from "./issues/docs.mjs";
import { proxyIssues } from "./issues/proxy.mjs";

const exec = promisify(execFile);
const DEFAULT_REPO = "KeyLease-Security/keylease-gateway";
const EXPECTED_TOTAL = 120;
const CREATE_DELAY_MS = 1200;

const issues = [
  ...proxyIssues,
  ...cliIssues,
  ...contractIssues,
  ...ciIssues,
  ...docsIssues,
];

function bodyFor(issue) {
  const lines = ["## Summary", "", issue.summary, ""];
  lines.push("## Motivation", "", issue.motivation, "");
  if (issue.files) {
    lines.push("## Where to start", "", issue.files, "");
  }
  lines.push("## Acceptance criteria", "");
  for (const task of issue.tasks) lines.push(`- [ ] ${task}`);
  lines.push("", "## Tech stack", "", issue.stack, "");
  return lines.join("\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runGh(args) {
  const { stdout } = await exec("gh", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function existingTitles(repo) {
  const stdout = await runGh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "title",
    "--jq",
    ".[].title",
  ]);
  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

async function createIssue(repo, issue, attempt = 1) {
  try {
    const stdout = await runGh([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      issue.title,
      "--label",
      issue.labels.join(","),
      "--body",
      bodyFor(issue),
    ]);
    return { ok: true, output: stdout.trim() };
  } catch (error) {
    const detail = (error.stderr || error.message || "").toString().trim();
    if (attempt < 4) {
      // Secondary rate limits and transient 5xx responses are worth retrying.
      await sleep(2000 * attempt);
      return createIssue(repo, issue, attempt + 1);
    }
    return { ok: false, output: detail };
  }
}

function summarise() {
  const byArea = new Map();
  const byPoints = new Map();
  for (const issue of issues) {
    const area = issue.labels.find((label) => label.startsWith("area/")) ?? "area/none";
    const points = issue.labels.find((label) => label.startsWith("points/")) ?? "points/none";
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
    byPoints.set(points, (byPoints.get(points) ?? 0) + 1);
  }
  console.log(`total issues: ${issues.length}`);
  console.log("by area  :", Object.fromEntries([...byArea].sort()));
  console.log("by points:", Object.fromEntries([...byPoints].sort()));
}

function validate() {
  if (issues.length !== EXPECTED_TOTAL) {
    console.error(`expected ${EXPECTED_TOTAL} issues, found ${issues.length}`);
    return false;
  }
  const titles = new Set();
  for (const issue of issues) {
    if (titles.has(issue.title)) {
      console.error(`duplicate title in batch: ${issue.title}`);
      return false;
    }
    titles.add(issue.title);
    if (!issue.labels.some((label) => label.startsWith("points/"))) {
      console.error(`missing points label: ${issue.title}`);
      return false;
    }
    if (!issue.labels.some((label) => label.startsWith("area/"))) {
      console.error(`missing area label: ${issue.title}`);
      return false;
    }
    if (!Array.isArray(issue.tasks) || issue.tasks.length < 3) {
      console.error(`too few acceptance criteria: ${issue.title}`);
      return false;
    }
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const repoFlag = args.indexOf("--repo");
  const repo = repoFlag >= 0 ? args[repoFlag + 1] : DEFAULT_REPO;

  if (repoFlag >= 0 && !repo) {
    console.error("--repo needs an owner/name value");
    process.exitCode = 1;
    return;
  }

  summarise();
  if (!validate()) {
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`\nrepo: ${repo} (dry run, nothing created)\n`);
    for (const issue of issues) {
      console.log(`- [${issue.labels.join(", ")}] ${issue.title}`);
    }
    return;
  }

  const existing = await existingTitles(repo);
  const todo = issues.filter((issue) => !existing.has(issue.title));
  console.log(`\nrepo: ${repo}`);
  console.log(`${issues.length - todo.length} already filed, ${todo.length} to create\n`);

  let created = 0;
  let failed = 0;
  for (const [index, issue] of todo.entries()) {
    const result = await createIssue(repo, issue);
    if (result.ok) {
      created += 1;
      console.log(`OK   ${result.output}  <- ${issue.title}`);
    } else {
      failed += 1;
      console.log(`FAIL ${issue.title}\n     ${result.output.replace(/\n/g, "\n     ")}`);
    }
    if (index < todo.length - 1) await sleep(CREATE_DELAY_MS);
  }

  console.log(`\ncreated ${created}, failed ${failed}, skipped ${issues.length - todo.length}`);
  if (failed > 0) process.exitCode = 1;
}

await main();
