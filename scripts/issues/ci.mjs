/** CI and tooling issues for the contributor batch. See scripts/create-issues.mjs. */
export const ciIssues = [
  {
    title: "ci: lint workflow files with actionlint",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add an actionlint job that validates `.github/workflows/*.yml`, including the new security workflow and its shell steps.",
    motivation:
      "A typo in a workflow expression or a bad `needs` reference only surfaces on the next PR, and a broken workflow can block merges entirely.",
    files: "`.github/workflows/ci.yml`, `.github/workflows/security.yml`",
    tasks: [
      "Run `actionlint` with `shellcheck` available so `run:` blocks are checked",
      "Trigger on changes to `.github/workflows/**` plus the regular PR checks",
      "Pin the actionlint version",
      "Document how to run it locally in CONTRIBUTING.md",
    ],
    stack: "GitHub Actions, actionlint, shellcheck",
  },
  {
    title: "ci: add cargo fmt --check and clippy to the contract job",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "The contract job runs tests and builds wasm but never formats or lints Rust. Add `cargo fmt --check` and `cargo clippy -- -D warnings`.",
    motivation:
      "Rust style drift and avoidable lints currently reach review. CI should reject them before a human reads the diff, and `-D warnings` keeps the bar fixed.",
    files: "`.github/workflows/ci.yml`, `contracts/keylease-core`",
    tasks: [
      "Install the rustfmt and clippy components in the toolchain step",
      "Run both before the contract tests so failures are fast",
      "Fix or explicitly allow the lints surfaced by the first run",
      "Document the commands in CONTRIBUTING.md",
    ],
    stack: "Rust, cargo, GitHub Actions",
  },
  {
    title: "ci: audit Rust dependencies with cargo audit",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci", "security"],
    summary:
      "Nothing checks `Cargo.lock` for advisories. Add a `cargo audit` job (or a `cargo-deny` check) to the security workflow.",
    motivation:
      "The contract is the value-bearing component; a known-vulnerable transitive crate should block a release even if the TypeScript side is clean.",
    files: "`.github/workflows/security.yml`, `contracts/keylease-core/Cargo.toml`",
    tasks: [
      "Install `cargo-audit` with a pinned version and run it against `contracts/keylease-core/Cargo.lock`",
      "Decide how to record an accepted advisory (ignore file with an expiry comment)",
      "Run on PRs touching `Cargo.*` and on the weekly schedule",
      "Document the triage process",
    ],
    stack: "Rust, cargo-audit, GitHub Actions",
  },
  {
    title: "ci: enforce vitest coverage thresholds",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "`pnpm test` runs vitest without coverage. Enable the v8 provider and fail the build below agreed per-package thresholds.",
    motivation:
      "The repo advertises a large, deterministic suite; without a threshold a PR can silently delete coverage. A floor makes the claim enforceable.",
    files: "`packages/cli/vitest.config.ts`, `packages/proxy/vitest.config.ts`, `.github/workflows/ci.yml`",
    tasks: [
      "Configure coverage with thresholds for lines, branches and functions",
      "Upload the coverage report as a CI artifact",
      "Exclude generated or untestable files explicitly, with a comment for each",
      "Document the thresholds and how to raise them in CONTRIBUTING.md",
    ],
    stack: "Vitest, v8 coverage, GitHub Actions",
  },
  {
    title: "ci: add CodeQL analysis for TypeScript and Rust",
    labels: ["enhancement", "size/medium", "points/150", "area/ci", "security"],
    summary:
      "Add a CodeQL workflow covering the TypeScript packages and the Rust contract, scheduled and on pull requests.",
    motivation:
      "Static analysis catches injection, unsafe deserialisation and arithmetic patterns that tests miss. It is free for public repositories and complements the malware scan.",
    files: "`.github/workflows/codeql.yml`",
    tasks: [
      "Use the `javascript-typescript` and `rust` language matrix",
      "Run on PRs to main plus a weekly schedule",
      "Keep build steps minimal so the analysis does not duplicate the full CI job",
      "Document how to triage new alerts",
    ],
    stack: "GitHub Actions, CodeQL",
  },
  {
    title: "ci: add Dependabot for npm, cargo and actions",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add `.github/dependabot.yml` with weekly updates for the pnpm workspace, the contract crate and GitHub Actions.",
    motivation:
      "Dependency updates arrive as reviewable PRs that run the full check suite, instead of as an emergency audit finding months later.",
    files: "`.github/dependabot.yml`",
    tasks: [
      "Configure pnpm, cargo and github-actions ecosystems",
      "Group minor/patch updates per ecosystem to keep PR volume low",
      "Set reviewers or labels consistent with the existing label scheme",
      "Document the update cadence in CONTRIBUTING.md",
    ],
    stack: "GitHub Actions, Dependabot",
  },
  {
    title: "ci: fail the build when the contract wasm exceeds a size budget",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "The published wasm is ~13.8 KB. Add a check in the contract job that fails when `keylease_core.wasm` grows past a documented budget (e.g. 20 KB).",
    motivation:
      "Wasm size affects deployment fees and resource limits. A budget turns a gradual, unnoticed creep into a review conversation.",
    files: "`.github/workflows/ci.yml`",
    tasks: [
      "Measure the built artifact after the wasm step and compare with the budget",
      "Print the current size and the budget on failure",
      "Allow an explicit override label with a justification comment",
      "Document the budget in the README",
    ],
    stack: "GitHub Actions, bash, stellar-cli",
  },
  {
    title: "ci: run the TypeScript suite on Node 20, 22 and 24",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "CI only tests Node 22 while `engines` promises `>=20.11`. Add a matrix for the supported line.",
    motivation:
      "A regression that only appears on the minimum supported version would ship undetected, which contradicts the published engine range.",
    files: "`.github/workflows/ci.yml`, `package.json`",
    tasks: [
      "Add a Node matrix for 20 and 22 (and 24 when the toolchain supports it)",
      "Keep the fast lane single-version if the full matrix is too slow; document the choice",
      "Ensure pnpm caching works per matrix entry",
      "Align the README badge with what CI actually runs",
    ],
    stack: "GitHub Actions, Node, pnpm",
  },
  {
    title: "ci: publish SLSA provenance and an SBOM with each release",
    labels: ["enhancement", "size/high", "points/200", "area/ci", "security"],
    summary:
      "The planned release workflow should attach a CycloneDX SBOM and provenance attestation for the built tarballs and the contract wasm.",
    motivation:
      "Consumers of a security product should be able to verify what went into an artifact. Provenance is also what makes a supply-chain compromise detectable after the fact.",
    files: "`.github/workflows/release.yml`, `scripts/`",
    tasks: [
      "Generate an SBOM for the pnpm workspace and for the contract crate",
      "Use `actions/attest-build-provenance` for the release artifacts",
      "Attach both to the GitHub release",
      "Document verification steps in SECURITY.md",
    ],
    stack: "GitHub Actions, CycloneDX, SLSA provenance",
  },
  {
    title: "ci: build and publish a proxy container image",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "Add a Dockerfile and a workflow that builds `@keylease/proxy` into a small image, publishes it to GHCR on tags, and scans it.",
    motivation:
      "Running the reference proxy currently requires cloning and building. A versioned image makes evaluation and deployment one command.",
    files: "`packages/proxy/Dockerfile`, `.github/workflows/release.yml`",
    tasks: [
      "Multi-stage build: install, build, prune dev dependencies",
      "Run as a non-root user with a HEALTHCHECK",
      "Publish to GHCR only on `v*` tags and sign the image",
      "Document `docker run` usage in the README",
    ],
    stack: "Docker, GitHub Actions, GHCR",
  },
  {
    title: "ci: add CODEOWNERS for security-sensitive paths",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add `.github/CODEOWNERS` so contract, workflow, proxy verification and security documentation changes request a maintainer review.",
    motivation:
      "A change to `contracts/` or `.github/workflows/` can affect escrow and CI trust without touching TypeScript. Review routing should reflect that risk.",
    files: "`.github/CODEOWNERS`",
    tasks: [
      "Cover `contracts/`, `.github/workflows/`, `SECURITY.md` and the proxy verifier/quota modules",
      "Keep the file minimal and explain each entry with a comment",
      "Confirm the owners exist and have write access",
      "Mention the policy in CONTRIBUTING.md",
    ],
    stack: "GitHub",
  },
  {
    title: "ci: add a stale issue and PR workflow",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add a scheduled workflow that marks issues and PRs stale after a documented period and closes them after a grace period, exempting `security` and `help wanted`.",
    motivation:
      "A 120-issue contributor batch needs gardening from day one, otherwise claimed-but-abandoned work hides free tasks from new contributors.",
    files: "`.github/workflows/stale.yml`",
    tasks: [
      "Set conservative intervals and grace periods",
      "Exempt `security`, `help wanted` and any `pinned` label",
      "Post a comment that explains how to keep an issue open",
      "Document the policy in CONTRIBUTING.md",
    ],
    stack: "GitHub Actions, actions/stale",
  },
  {
    title: "ci: check documentation links on every PR",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add a link checker over Markdown files so the README, CONTRIBUTING, SECURITY and issue templates cannot accumulate dead links.",
    motivation:
      "Docs link to stellar.expert transactions, the contract explorer and external SDKs. Rotting links make a security project look abandoned.",
    files: "`.github/workflows/docs.yml`",
    tasks: [
      "Run `lychee` (or equivalent) on changed Markdown files and on a schedule",
      "Allow-list known-flaky hosts with a comment per entry",
      "Report failures as PR annotations",
      "Document local usage",
    ],
    stack: "GitHub Actions, lychee",
  },
  {
    title: "ci: add a spellcheck for prose and identifiers",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "Add `typos` over the repository with a small allow-list for Stellar/Soroban terms.",
    motivation:
      "Typos in documentation and error messages are the most visible quality signal in a developer tool, and they are trivial to prevent.",
    files: "`.github/workflows/docs.yml`, `_typos.toml`",
    tasks: [
      "Configure `typos` to skip lockfiles and generated artifacts",
      "Add domain words (`Soroban`, `stroops`, `ed25519`, ...) to the allow-list",
      "Fix the findings in the first run",
      "Document the local command",
    ],
    stack: "GitHub Actions, typos-cli",
  },
  {
    title: "ci: lint commit messages for Conventional Commits",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "Add a PR check that validates the PR title (or commit range) against Conventional Commits, matching the existing `feat(proxy):` style.",
    motivation:
      "The history already follows the convention manually. Enforcing it keeps the changelog and release notes generatable without cleanup.",
    files: "`.github/workflows/ci.yml`, `.github/pull_request_template.md`",
    tasks: [
      "Lint the PR title with a documented type/scope list",
      "Exempt merge commits and dependabot PRs",
      "Print a copy-pasteable corrected title on failure",
      "Document the convention in CONTRIBUTING.md",
    ],
    stack: "GitHub Actions, commitlint",
  },
  {
    title: "ci: guard against a stray package-lock.json reappearing",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "The repository is pnpm-only and `.gitignore` lists `package-lock.json`, but a force-add or a tool run can still introduce one. Add a CI check that rejects it.",
    motivation:
      "The history already shows a lockfile added and removed. A 20-line check prevents the same cleanup commit from being needed again.",
    files: "`.github/workflows/ci.yml`",
    tasks: [
      "Fail when a tracked `package-lock.json`, `yarn.lock` or `bun.lockb` exists",
      "Point the failure message at the pnpm workspace setup",
      "Add a test in the workflow with `git ls-files`",
      "Reference the rule in CONTRIBUTING.md",
    ],
    stack: "GitHub Actions, bash",
  },
  {
    title: "ci: smoke-test the built proxy binary",
    labels: ["enhancement", "size/trivial", "points/100", "area/ci"],
    summary:
      "After `pnpm build`, start `packages/proxy/dist/index.js` with a minimal env, hit a route, and assert a 401 with the documented JSON body.",
    motivation:
      "Unit tests import the modules directly; a broken bin entrypoint, missing shebang or bad ESM path only shows up when someone runs the package. The build artifact should be exercised.",
    files: "`.github/workflows/ci.yml`",
    tasks: [
      "Boot the proxy on an ephemeral port with a stub upstream URL",
      "Assert the process starts, responds 401 `missing_token` and exits cleanly on SIGTERM",
      "Fail on any unhandled output on stderr",
      "Keep the step fast and dependency-free",
    ],
    stack: "GitHub Actions, Node, bash",
  },
  {
    title: "ci: comment a coverage summary on pull requests",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "Publish a per-package coverage delta as a PR comment so reviewers see the effect of a change without opening the artifact.",
    motivation:
      "Coverage thresholds stop the worst regressions but say nothing about a 3% drop inside a large PR. A delta comment makes the trade-off visible during review.",
    files: "`.github/workflows/ci.yml`, `scripts/coverage-comment.mjs`",
    tasks: [
      "Parse the vitest coverage summary produced by the test job",
      "Post or update a single sticky comment, never a new one per push",
      "Show lines/branches per package and the delta against the base branch",
      "Skip gracefully on fork PRs without comment permission",
    ],
    stack: "GitHub Actions, Node, Vitest coverage",
  },
  {
    title: "test: benchmark the verifier and quota hot paths",
    labels: ["enhancement", "size/medium", "points/150", "area/ci"],
    summary:
      "Add a small benchmark suite (vitest bench) for `LeaseVerifier.verify` cache hits, cache misses and `OnChainQuota.record`, with a CI trend report.",
    motivation:
      "The proxy is on the request path for a paid API; a regression from a new branch in the verifier is invisible to unit tests. Numbers make performance work reviewable.",
    files: "`packages/proxy/src/bench/verifier.bench.ts`, `package.json`",
    tasks: [
      "Benchmark cache hit, cache miss, quota record and header building",
      "Keep the benchmark deterministic and free of network access",
      "Store the baseline and report the delta on PRs or on main",
      "Document how to run and interpret the benchmark",
    ],
    stack: "Vitest bench, Node, GitHub Actions",
  },
  {
    title: "ci: run a scheduled pnpm audit and open an issue on new advisories",
    labels: ["enhancement", "size/medium", "points/150", "area/ci", "security"],
    summary:
      "Add a weekly workflow that runs `pnpm audit --audit-level=high`, and files or updates a single tracking issue when a new advisory affects the workspace lockfile.",
    motivation:
      "Advisories are published after a dependency is merged, so a PR-only check cannot catch them. A scheduled job with one deduplicated issue keeps the backlog honest without failing unrelated PRs.",
    files: ".github/workflows/security.yml, scripts/audit-report.mjs",
    tasks: [
      "Run the audit on the workspace lockfile and parse the JSON output",
      "Search for an existing tracking issue before creating one, and update it in place",
      "Include the advisory id, severity, package and fixed version in the body",
      "Fail the workflow only when the audit command itself errors, not when advisories are found",
      "Document the triage policy in SECURITY.md",
    ],
    stack: "GitHub Actions, pnpm, Node",
  },
];
