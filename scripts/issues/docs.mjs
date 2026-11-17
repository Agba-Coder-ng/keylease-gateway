/** Documentation issues for the contributor batch. See scripts/create-issues.mjs. */
export const docsIssues = [
  {
    title: "docs: document contract error 14 and the full status-code mapping",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "The README contract error table stops at code 13, but `Error::Unauthorized = 14` exists in the contract. Add it and cross-check every code against `lib.rs`.",
    motivation:
      "Operators and contributors use this table to interpret CLI and proxy failures. A missing row sends them to the source for a code the docs claim to cover.",
    files: "`README.md`, `contracts/keylease-core/src/lib.rs`",
    tasks: [
      "Add `14 | Unauthorized | The signer is not the consumer, provider, admin or gateway`",
      "Verify codes 1-14 against the enum and correct any other drift",
      "Add a one-line note explaining where the proxy maps the codes",
      "Link the table from the CLI help or error-message documentation",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add ARCHITECTURE.md with the threat model",
    labels: ["documentation", "size/medium", "points/150", "area/docs", "security"],
    summary:
      "Move the architecture reasoning out of the README into `docs/architecture.md`, and add explicit trust boundaries and an attacker model for token forgery, quota bypass and escrow payout.",
    motivation:
      "The README explains how the system works but not what it defends against. Security reviewers need the threat model in one place, next to the design it justifies.",
    files: "`README.md`, `docs/architecture.md`, `SECURITY.md`",
    tasks: [
      "Document the trust boundaries: client, proxy, Soroban RPC, contract, SAC token",
      "List the assets (escrow, quota, consumer keys) and the attacker capabilities in scope",
      "Explain why each control (offline signature check, simulated reads, on-chain quota) exists",
      "Link the page from README and SECURITY.md, and keep the README diagram",
    ],
    stack: "Markdown, Mermaid",
  },
  {
    title: "docs: add a proxy operations runbook",
    labels: ["documentation", "size/medium", "points/150", "area/docs"],
    summary:
      "Write `docs/runbook.md` covering startup checks, the meaning of each 5xx, how to read quota drift, how to rotate the gateway key, and how to restart without losing calls.",
    motivation:
      "The proxy is a stateful edge service with on-chain side effects. An operator paging at 2am should not have to infer the recovery procedure from source code.",
    files: "`docs/runbook.md`, `README.md`",
    tasks: [
      "Include a startup checklist (env, contract, gateway key, RPC reachability)",
      "Document each 5xx with the first diagnostic command to run",
      "Explain how to reconcile `calls_used` after a crash using `use_call`",
      "Add key-rotation steps and rollback guidance",
      "Link the runbook from the README deployments section",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add a troubleshooting guide for common CLI errors",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Create a troubleshooting section mapping the most common failures (`missing_option`, `invalid_consumer`, `Error(Contract, #3)`, 401/403 from the proxy) to a fix.",
    motivation:
      "The same setup questions recur: wrong network, unfunded testnet account, stale session file, service not registered. One page answers them all.",
    files: "`README.md` or `docs/troubleshooting.md`",
    tasks: [
      "Cover at least ten concrete error messages with cause and fix",
      "Show the exact command or environment change for each",
      "Explain the difference between an offline token check and a live lease read",
      "Link the page from CONTRIBUTING.md",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add CHANGELOG.md following Keep a Changelog",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Add a `CHANGELOG.md` with an `Unreleased` section and entries for the current contract and packages, following Keep a Changelog and SemVer.",
    motivation:
      "The repository already suffered a docs-only commit describing an appeal rather than shipped changes. A real changelog makes releases auditable and reviewable.",
    files: "`CHANGELOG.md`, `README.md`",
    tasks: [
      "Summarise the contract rename/rework and the current 0.2.0 contract version",
      "Add Added/Changed/Fixed/Security headings",
      "State the pre-1.0 compatibility policy",
      "Link the file from the README and CONTRIBUTING",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add a mainnet readiness checklist",
    labels: ["documentation", "size/medium", "points/150", "area/docs", "security"],
    summary:
      "Document the concrete gates before this software touches mainnet value: independent audit, key custody, RPC redundancy, monitoring, incident response and the refund path.",
    motivation:
      "SECURITY.md says no mainnet value until an audit is announced. A checklist makes that statement actionable instead of aspirational.",
    files: "`SECURITY.md`, `docs/mainnet-readiness.md`",
    tasks: [
      "List technical, operational and security gates with owners",
      "Include escrow solvency checks and a settlement drill on testnet",
      "Define the go/no-go sign-off",
      "Link the checklist from the README deployments section",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: explain quota batching semantics and failure modes",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Document that the local counter is a fast path, that commits are batched and fire-and-forget, and what happens on restart, RPC failure or two proxies sharing a lease.",
    motivation:
      "The README says quota is enforced on chain, but the batching window is where operators get surprised: a killed proxy can under-report usage until the chain is reconciled.",
    files: "`README.md`, `packages/proxy/src/quota.ts`",
    tasks: [
      "Describe the batch size, flush interval and retry behaviour",
      "Explain the crash window and how to reconcile with `use_call`",
      "Cover two proxy instances serving the same lease",
      "Add a short sequence diagram for the commit path",
    ],
    stack: "Markdown, Mermaid",
  },
  {
    title: "docs: add a contributor walkthrough for good first issues",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Extend CONTRIBUTING.md with a step-by-step first contribution: claim an issue, branch, build, run the focused test, fill the PR template and link the issue.",
    motivation:
      "The batch of 120 issues targets newcomers. A walkthrough that starts from `git clone` removes the setup friction that makes them bounce.",
    files: "`CONTRIBUTING.md`",
    tasks: [
      "Show the exact commands with expected output",
      "Explain the label scheme and point values",
      "Add a short 'what a reviewable PR looks like' checklist",
      "Link three example good-first issues and the test conventions",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add a proxy HTTP reference",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Create a reference page for the proxy surface: routes, required headers, response headers, the full status-code table and the JSON error schema.",
    motivation:
      "The README has a partial table aimed at operators. Integrators need a precise contract they can code against, including header casing and error bodies.",
    files: "`docs/proxy-api.md`, `README.md`",
    tasks: [
      "Document all routes and methods, including the health endpoints once merged",
      "Specify `Authorization`, `Content-Type` and the `x-keylease-*` headers",
      "Provide one JSON example per error code",
      "State the timeout and body-limit defaults",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add integration snippets for curl, Node and Go",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Add copy-paste examples that acquire a lease, export the token and call the proxy from curl, a Node `fetch` script and a Go client.",
    motivation:
      "Most evaluators are integrating from another language. Working snippets shorten the path from 'interesting' to 'it works in my stack'.",
    files: "`docs/integrations.md`, `README.md`",
    tasks: [
      "Use testnet only and never embed a real seed",
      "Show error handling for 401, 403 quota and 503",
      "Explain that the token is a bearer credential and where to store it",
      "Link the page from the README quickstart",
    ],
    stack: "Markdown, TypeScript, Go",
  },
  {
    title: "docs: document the session token format with a worked example",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Specify `kls1.<payload>.<signature>` precisely: payload fields, base64url rules, the signed bytes, expiry/skew semantics and error codes, with a decoded example.",
    motivation:
      "Third-party proxies or verifiers need the exact format. 'ed25519-signed token' is not enough to reimplement interoperably.",
    files: "`docs/session-token.md`, `packages/cli/src/token.ts`",
    tasks: [
      "Document every field, its type and its meaning",
      "State that the signature covers the transmitted payload segment verbatim",
      "Explain clock skew and the `token_not_yet_valid` error",
      "Provide a decoded sample payload and a verification pseudocode block",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add a security review checklist template",
    labels: ["documentation", "size/medium", "points/150", "area/docs", "security"],
    summary:
      "Add `.github/security-review.md` describing what a reviewer checks for changes touching tokens, quota, escrow, headers or CI.",
    motivation:
      "The issue templates ask for tests but not for security reasoning. A checklist makes the threat model reviewable on every risky PR instead of only at audit time.",
    files: "`.github/security-review.md`, `SECURITY.md`",
    tasks: [
      "Cover auth, token binding, quota accounting and escrow invariants",
      "Add header/SSRF/secret-handling checks for the proxy",
      "Require a rollback plan for contract changes",
      "Link the checklist from the PR template",
    ],
    stack: "Markdown",
  },
  {
    title: "docs: add a diagram for the quota commit path",
    labels: ["documentation", "size/trivial", "points/100", "area/docs"],
    summary:
      "Add a Mermaid sequence diagram showing request admission, local counter increment, batching, retry and the periodic flush, including the failure branches.",
    motivation:
      "The existing diagram shows the happy path. The quota commit is the part operators and contributors most often misunderstand.",
    files: "`README.md`, `docs/architecture.md`",
    tasks: [
      "Show cache hit vs cache miss on the lease read",
      "Show the batch threshold and timer flush paths",
      "Show a failed commit being requeued",
      "Keep the diagram consistent with the implementation",
    ],
    stack: "Markdown, Mermaid",
  },
  {
    title: "docs: document testnet roles and how to rotate their keys",
    labels: ["documentation", "size/medium", "points/150", "area/docs", "security"],
    summary:
      "Document the admin, gateway, provider and consumer accounts, where their seeds live, which commands sign with which role, and the rotation procedure.",
    motivation:
      "The deploy script creates four roles and writes seeds to a git-ignored file. Without documentation, contributors reuse one key for everything and lose the role separation.",
    files: "`README.md`, `packages/cli/scripts/deploy-testnet.mjs`, `deployments.json`",
    tasks: [
      "Describe each role and the entrypoints it may call",
      "Explain `set_gateway` rotation and the consequences for a running proxy",
      "Document seed storage and the rule against committing `.keylease/`",
      "Add a rotation drill using fresh testnet accounts",
    ],
    stack: "Markdown, Stellar testnet",
  },
];
