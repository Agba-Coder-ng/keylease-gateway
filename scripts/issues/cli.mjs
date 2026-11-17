/** CLI issues for the contributor batch. See scripts/create-issues.mjs. */
export const cliIssues = [
  {
    title: "feat(cli): add a keylease quote command",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "Expose the contract's `quote(service, calls)` view as `keylease quote --service <id> --calls <n>`, printing the price in token smallest units and in XLM.",
    motivation:
      "Consumers currently have to acquire a lease to discover its price. A read-only quote is the first thing anyone wants before signing a `create_lease` transaction.",
    files:
      "`packages/cli/src/index.ts`, `packages/cli/src/commands/lease.ts`, `packages/cli/src/client/soroban.ts`",
    tasks: [
      "Add `quote` to the command union, argv parsing and help text",
      "Use `SorobanClient.quote` through an injectable dependency so tests stay offline",
      "Support `--json` with `{ service, calls, price, asset }`",
      "Tests cover valid input, zero calls and an unknown service (`Error(Contract, #3)`)",
      "Document the command in the README CLI reference table",
    ],
    stack: "TypeScript, @stellar/stellar-sdk, Vitest",
  },
  {
    title: "feat(cli): add keylease use-call for committing served calls",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "Add `keylease use-call --lease <id> --count <n> --secret <gateway-seed>` that invokes `use_call`, so operators can reconcile quota after a proxy outage.",
    motivation:
      "When a gateway loses pending quota (crash, failed commit), the only remedy today is a hand-built contract invocation. The client already exposes `useCalls`; only the command is missing.",
    files:
      "`packages/cli/src/index.ts`, `packages/cli/src/commands/lifecycle.ts`, `packages/cli/src/client/soroban.ts`",
    tasks: [
      "Add the command with `--lease`, `--count` and `--secret`, plus the shared network flags",
      "Print the updated `calls_used`/`calls_limit` and support `--json`",
      "Return a clear error when the signer is not the registered gateway",
      "Tests use an injected client for success, `LeaseExpired` and `Unauthorized`",
      "Warn in the help text that this spends quota without serving a call",
    ],
    stack: "TypeScript, @stellar/stellar-sdk, Vitest",
  },
  {
    title: "feat(cli): add --dry-run to acquire that quotes the price first",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`acquire` signs and submits a payment immediately. Add `--dry-run` that calls `quote` and prints the price and expiry without touching the network state.",
    motivation:
      "A typo in `--calls` currently costs real testnet XLM and leaves an unwanted lease. A dry run makes the price visible before the transaction is signed.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/lease.ts`",
    tasks: [
      "Add `--dry-run` to `acquire` and skip `createLease`/token minting when set",
      "Print service, calls, duration, quoted price and the resulting expiry",
      "Require `--secret` only when not a dry run, or derive the consumer from it when supplied",
      "Tests assert no client invocation and no session-store write on a dry run",
      "Document the flag in the README CLI table",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): generate shell completions for bash, zsh and fish",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "Add `keylease completions <shell>` that prints a completion script covering commands, flags and the `--network` values.",
    motivation:
      "The CLI has ten flags and five commands; typing them from memory is the main source of `missing_option` errors. Completions make the tool pleasant without adding a runtime dependency.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/completions.ts`",
    tasks: [
      "Render static completion scripts for bash, zsh and fish from one command/flag table",
      "Reject an unknown shell with a usage error listing the supported ones",
      "Add a test that every documented command and option appears in each script",
      "Document installation in the README, including the `source <(keylease completions bash)` form",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): support a .keyleaserc configuration file",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "Read `network`, `rpc`, `contract` and `defaultService` from `.keyleaserc.json` in the working directory, with a documented precedence of flag > environment > file > default.",
    motivation:
      "CI jobs and teams repeat the same `--network/--rpc/--contract` triple on every command. A checked-in config file (like `.nvmrc`) removes that repetition without changing existing behaviour.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/config.ts`",
    tasks: [
      "Load and validate the file once per invocation; ignore a missing file",
      "Reject unknown keys and wrong types with an actionable `CliError`",
      "Apply precedence explicitly and test every layer",
      "Document the file, its keys and the precedence order in the README",
    ],
    stack: "TypeScript, Node fs, Vitest",
  },
  {
    title: "feat(cli): bind session tokens to the leased service",
    labels: ["enhancement", "size/high", "points/200", "area/cli", "security"],
    summary:
      "A `kls1` token carries `lease_id`, `consumer`, `iat` and `exp`, but not the service the lease was bought for. Add a `service` claim and verify it where the expected service is known.",
    motivation:
      "Service binding lives on chain, so a token cannot be replayed across services today only because the proxy re-reads the lease. Putting the claim in the token makes the intended scope explicit and lets offline verification catch a cross-service token.",
    files:
      "`packages/cli/src/token.ts`, `packages/cli/src/commands/lease.ts`, `packages/cli/src/token.test.ts`",
    tasks: [
      "Add an optional `service` claim, keeping v1 tokens verifiable",
      "`acquire` populates it from `--service`; `verifySessionToken` accepts `expectedService`",
      "Reject mismatches with a new `service_mismatch` token error code",
      "Tests cover legacy tokens without the claim, matching and mismatching tokens",
      "Document the payload change and the compatibility rule",
    ],
    stack: "TypeScript, ed25519, Vitest",
  },
  {
    title: "feat(cli): add a --quiet flag for scripted use",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "Add `--quiet` that suppresses human-readable success output while keeping errors on stderr and preserving exit codes.",
    motivation:
      "Shell scripts that only need the exit status currently have to pipe everything to `/dev/null`, which also hides failures. `--json` is not always the right answer for a boolean check.",
    files: "`packages/cli/src/index.ts`",
    tasks: [
      "Parse `--quiet` globally and wrap the `CliIo` so `out` becomes a no-op",
      "Keep `err` untouched and never change exit codes",
      "Test that `acquire --quiet` writes nothing to stdout and still saves the session",
      "Document the flag in the help text and README",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): add keylease whoami",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "Add `keylease whoami` that prints the resolved network, contract id, RPC URL, the consumer public key when `--secret` is supplied, and the locally stored sessions.",
    motivation:
      "Before filing a bug or running a demo, the first question is which network and contract a terminal is pointed at. It should take one command, not three env lookups.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/config.ts`",
    tasks: [
      "Resolve config the same way the network commands do",
      "Derive the public key from `--secret` without printing the seed",
      "List stored services and lease ids with their expiry",
      "Tests cover configured, unconfigured and secret-supplied cases",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "fix(cli): keep .env files at 0600 when they already exist",
    labels: ["bug", "size/trivial", "points/100", "area/cli", "security"],
    summary:
      "`envCommand` writes with `{ mode: 0o600 }`, but Node only applies `mode` when creating a file. An existing `.env` with `0644` keeps its world-readable permissions while receiving session tokens.",
    motivation:
      "The written file contains a bearer token for a paid lease. Silently leaving it readable by other local users is exactly the secret-leak class in `SECURITY.md`.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/lease.test.ts`",
    tasks: [
      "Chmod the target file to `0600` after writing (and on the read path if it is wider)",
      "Skip the chmod on platforms where it is unsupported, without failing the command",
      "Test that an existing `0644` file ends up `0600`",
      "Mention the permission behaviour in the README `env` section",
    ],
    stack: "TypeScript, Node fs, Vitest",
  },
  {
    title: "fix(cli): quote values written by keylease env",
    labels: ["bug", "size/trivial", "points/100", "area/cli"],
    summary:
      "`mergeEnv` writes `KEY=VALUE` verbatim. A service id containing spaces or `#`, or a future token format with shell metacharacters, produces a `.env` that shells parse incorrectly.",
    motivation:
      "The `.env` is meant to be `source`d. Escaping quotes and `#` (or wrapping values in double quotes) is the difference between a working session and a confusing 401.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/lease.test.ts`",
    tasks: [
      "Add a single quoting helper used by every entry, double-quoting and escaping `\\`, `\"` and `$`",
      "Keep plain alphanumeric values unquoted for readability",
      "Round-trip test through a small shell-compatible parser in the test",
      "Update the README `env` example",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "fix(cli): mergeEnv should replace export-prefixed keys",
    labels: ["bug", "size/trivial", "points/100", "area/cli"],
    summary:
      "The `mergeEnv` regex only matches `KEY=value`, so an existing `export KEYLEASE_SESSION_TOKEN=old` line is preserved and a second unexported assignment is appended. Shells then disagree about which value wins.",
    motivation:
      "Users commonly `export` keys in `.env` files. Leaving a stale exported token in place is a silent auth failure that looks like a proxy bug.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/lease.test.ts`",
    tasks: [
      "Extend the line matcher to accept an optional `export ` prefix and preserve it when rewriting",
      "Drop duplicate assignments of the same key regardless of prefix",
      "Test with mixed exported/unexported files and trailing comments",
      "Document the merge rule in the README",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): store multiple leases per service",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`.keylease/sessions.json` is keyed by service id, so acquiring a second lease for the same service silently replaces the first. Store a list per service and let `env` pick the newest unexpired lease.",
    motivation:
      "Re-acquiring before the previous lease expires is normal (renewal, parallel CI jobs). Today the older lease is orphaned and its remaining calls are lost from the CLI's view.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/lease.test.ts`",
    tasks: [
      "Migrate the store to `{ [service]: LeaseSession[] }` while reading the old object shape",
      "`env` selects the newest unexpired lease and `--lease <id>` selects an explicit one",
      "Keep `save` idempotent for the same lease id",
      "Tests cover migration from v1, selection and an all-expired service",
      "Document the storage change and that the file stays git-ignored",
    ],
    stack: "TypeScript, JSON, Vitest",
  },
  {
    title: "feat(cli): print remaining calls in keylease status --lease",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "`status --lease` prints `calls_used/calls_limit` but not the remaining count, which is the number consumers actually care about before wiring the proxy.",
    motivation:
      "A lease with 1 of 500 calls left looks healthy in the current output. Showing the remainder (and zero when inactive/settled) matches `remaining_calls` on chain.",
    files: "`packages/cli/src/commands/status.ts`, `packages/cli/src/commands/status.test.ts`",
    tasks: [
      "Print `remaining : n` and include `remainingCalls` in the JSON output",
      "Return zero for settled, inactive or expired leases, matching the contract view",
      "Test each of those states",
      "Keep the existing line format stable for anything that greps it",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): machine-readable errors when --json is set",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "With `--json`, success output becomes JSON but errors still go to stderr as prose. Emit `{ error: { code, message, hint? } }` on stderr while keeping the documented exit codes.",
    motivation:
      "CI wrappers currently have to scrape English text to tell a configuration error from an RPC failure. The CLI already carries codes on `CliError` and `TokenVerificationError`; it just does not expose them.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/status.ts`",
    tasks: [
      "Detect `--json` before dispatch and route errors through one renderer",
      "Map every caught error to `{ code, message }`, defaulting to `internal_error`",
      "Keep stdout clean so `--json` output remains parseable",
      "Tests assert stderr parses as JSON and the exit code is unchanged",
      "Document the error schema in the README",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): retry transient Soroban RPC failures with backoff",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`SorobanClient.simulate` and `invoke` fail on the first 429 or 5xx from Soroban RPC. Add a bounded retry with exponential backoff for idempotent reads and for submission of the same signed transaction.",
    motivation:
      "Public testnet RPC regularly returns transient 5xx during congestion, and the current failure costs the user a whole command and sometimes an unsigned lease.",
    files: "`packages/cli/src/client/soroban.ts`, `packages/cli/src/client/soroban.test.ts`",
    tasks: [
      "Retry only on 429/5xx/timeout, never on a contract error",
      "Respect `Retry-After` when present and cap total attempts",
      "Inject the sleep function so tests do not wait",
      "Test that a successful retry returns the original result and that contract errors are not retried",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): map contract error codes to actionable messages",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "Contract failures surface as `keylease-core.settle failed with Error(8)` and stop there. Translate the documented `Error` enum into a message plus a next step (wait for expiry, fund the account, check the lease id).",
    motivation:
      "`Error(8)` means nothing to a contributor or a user without the README table. The CLI has the code and method in `ContractCallError`, so a small mapping removes a support loop.",
    files: "`packages/cli/src/client/soroban.ts`, `packages/cli/src/commands/lifecycle.ts`",
    tasks: [
      "Add one mapping table keyed by the contract's error code",
      "Include the code in the message for traceability and keep the raw detail available with `--json`",
      "Cover every variant 1-14 with a unit test, including unknown codes",
      "Link the README error table from the help text",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "fix(cli): validate --rpc URLs before building a client",
    labels: ["bug", "size/trivial", "points/100", "area/cli"],
    summary:
      "`--rpc` is passed straight into `new rpc.Server(url)`. A typo such as `htps://...` or a bare host fails deep inside the SDK with an unhelpful error.",
    motivation:
      "RPC URL typos are the most common local setup mistake. Rejecting them at parse time with the bad value in the message turns a stack trace into a one-line fix.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/client/soroban.ts`",
    tasks: [
      "Parse `--rpc` and `KEYLEASE_RPC_URL` with `new URL` and require `http:` or `https:`",
      "Allow `http:` only for `local`/localhost, matching the SDK's `allowHttp` rule",
      "Throw `CliError('invalid_option')` naming the offending value",
      "Tests cover valid, non-URL and wrong-scheme values",
    ],
    stack: "TypeScript, Node URL, Vitest",
  },
  {
    title: "fix(cli): reject lease ids with leading zeros",
    labels: ["bug", "size/trivial", "points/100", "area/cli"],
    summary:
      "`parseLeaseId` accepts `00`, `007` and `18446744073709551615` alike. Leading zeros make two different strings refer to the same lease, which breaks token/lease comparisons and log correlation.",
    motivation:
      "Token payloads carry the lease id as a string. If `0007` is accepted, a session minted for one spelling may not match the id the proxy later compares against.",
    files: "`packages/cli/src/client/soroban.ts`, `packages/cli/src/client/soroban.test.ts`",
    tasks: [
      "Require the canonical decimal form (`/^(0|[1-9][0-9]*)$/`, still rejecting `0`)",
      "Keep the u64 range check",
      "Test canonical, zero, leading-zero and out-of-range ids",
      "Document the canonical form in the README `--lease` help",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): add --fee and --timeout to transaction commands",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`SorobanClient.build` always uses `BASE_FEE` and a fixed 60s transaction timeout. Expose both on `acquire`, `settle` and `revoke`.",
    motivation:
      "During testnet congestion the base fee is not enough, and a lease transaction that needs longer than a minute is submitted with the wrong envelope timeout. Both are operator-level knobs the SDK already supports.",
    files:
      "`packages/cli/src/index.ts`, `packages/cli/src/client/soroban.ts`, `packages/cli/src/commands/lifecycle.ts`",
    tasks: [
      "Add `--fee <stroops>` and `--timeout <seconds>` with validation",
      "Thread them through `SorobanClientOptions` into the transaction builder",
      "Keep the current defaults when the flags are absent",
      "Tests assert the built envelope uses the supplied values",
      "Document both flags in the README common-flags paragraph",
    ],
    stack: "TypeScript, @stellar/stellar-sdk, Vitest",
  },
  {
    title: "feat(cli): show network and contract id in status output",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "`status --lease` prints lease fields but not which network or contract answered. Add the network name and a truncated contract id to both human and JSON output.",
    motivation:
      "The same lease id exists on testnet and mainnet. Without the network in the output, a copy-pasted report is ambiguous and support has to ask.",
    files: "`packages/cli/src/commands/status.ts`, `packages/cli/src/commands/status.test.ts`",
    tasks: [
      "Resolve the network name and contract id alongside the client",
      "Add them to the human output and to the JSON payload",
      "Keep the fields optional in the dependency type so existing tests stay simple",
      "Update the README example output",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): settle or revoke several leases in one invocation",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`settle` and `revoke` take a single `--lease`. Accept the flag multiple times (or a comma-separated list) and process each lease, reporting per-lease outcomes.",
    motivation:
      "A CI job that acquired five leases has to run five commands and loses the aggregate result. Batch handling also makes cleanup scripts idempotent when one lease already settled.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/lifecycle.ts`",
    tasks: [
      "Accept repeated `--lease` values and de-duplicate them",
      "Continue past an `AlreadySettled` lease, then exit non-zero only for real failures",
      "Render a summary table plus a machine-readable array under `--json`",
      "Tests cover all-success, partial failure and duplicate ids",
      "Document the batching behaviour and its exit codes",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "test(cli): golden tests for human-readable command output",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "Human-readable output of `acquire`, `status`, `env` and the lifecycle commands is only asserted piecemeal. Add golden files so formatting regressions are visible in review.",
    motivation:
      "People grep this output in scripts and paste it into issues. A deliberate snapshot makes format changes a decision rather than an accident.",
    files: "`packages/cli/src/**/*.test.ts`, `packages/cli/test/golden/*.txt`",
    tasks: [
      "Capture output through the injected `CliIo` for each command and compare to a fixture",
      "Normalise timestamps, addresses and hashes so fixtures are stable",
      "Keep `--json` covered by schema assertions instead of snapshots",
      "Document how to regenerate fixtures when a format change is intentional",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "fix(cli): never echo a session token in an error message",
    labels: ["bug", "size/trivial", "points/100", "area/cli", "security"],
    summary:
      "Audit every error path that receives a token (`status --token`, parse failures, RPC errors) and guarantee the raw `kls1.*` value is never written to stdout, stderr or a JSON error payload.",
    motivation:
      "Terminal output ends up in CI logs and pasted issues. A token is a bearer credential for paid quota, so leaking it in a parse error is a real incident.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/status.ts`",
    tasks: [
      "Add one redaction helper that replaces `kls1.<...>` with `kls1.<redacted>`",
      "Apply it in the top-level error handler and in `status --token` failures",
      "Add a test that a deliberately malformed token never appears verbatim in stderr",
      "Note the redaction guarantee in the README token section",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): reject durations beyond a documented maximum",
    labels: ["enhancement", "size/trivial", "points/100", "area/cli"],
    summary:
      "`--duration` accepts any positive safe integer, including values whose `now + duration` exceeds u64 seconds. Validate against a documented maximum (e.g. 365 days).",
    motivation:
      "A realistic maximum catches unit mistakes (`--duration 3600000` meant as ms) before a transaction is signed, rather than after an opaque contract failure.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/lease.ts`",
    tasks: [
      "Add a shared maximum-duration constant and validate in argv parsing",
      "Explain the accepted range in the error message and help text",
      "Test the limit, one second over and zero",
      "Document the range in the README CLI table",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): record the quoted price in the session store",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`LeaseSession` stores calls and expiry but not what the lease cost. Quote before `create_lease` and store `pricePaid` plus `pricePerCall` so `status`/`sessions` can show the spend.",
    motivation:
      "Consumers cannot reconcile a testnet XLM balance against the leases the CLI created. Persisting the quoted price makes the CLI a usable ledger without extra RPC calls.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/status.ts`",
    tasks: [
      "Quote the lease before paying and store the result on the session",
      "Tolerate old sessions without the field",
      "Show cost in `status --lease` and in the JSON output",
      "Tests cover a quote mismatch (contract price changed mid-flight) and legacy sessions",
      "Document the new stored fields",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): add --check-chain to status --token",
    labels: ["enhancement", "size/medium", "points/150", "area/cli"],
    summary:
      "`status --token` verifies the signature and expiry offline only. Add `--check-chain` that also simulates `get_lease` and confirms the consumer, service and remaining quota still match the token.",
    motivation:
      "An offline-valid token can still reference a revoked, settled or unknown lease. The proxy makes that check on every request; the CLI should be able to reproduce the verdict.",
    files: "`packages/cli/src/commands/status.ts`, `packages/cli/src/index.ts`",
    tasks: [
      "Add the flag and an injectable `LeaseStateProvider` dependency",
      "Report each check (signature, expiry, lease active, consumer match, quota) with a pass/fail line",
      "Return exit code 1 when any check fails and support `--json`",
      "Tests cover a valid lease, a revoked lease and an RPC failure without hiding the token",
      "Document the flag and what it proves",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(cli): read the consumer secret from stdin or an environment variable",
    labels: ["enhancement", "size/medium", "points/150", "area/cli", "security"],
    summary:
      "`--secret S...` puts the Stellar seed in shell history, process listings and CI logs. Add `--secret -` (read stdin) and `KEYLEASE_SECRET` as fallbacks, with the flag still winning.",
    motivation:
      "The README promises the seed never leaves the process, but the command line does leak it to the shell and `ps`. Reading from stdin or an env var makes that promise true in practice.",
    files: "`packages/cli/src/index.ts`, `packages/cli/src/commands/lease.ts`",
    tasks: [
      "Accept `--secret -` and read one line from stdin without echoing it",
      "Fall back to `KEYLEASE_SECRET` with precedence flag > env",
      "Keep the existing seed validation and error message",
      "Tests cover stdin, env fallback, precedence and a missing secret",
      "Warn in the help text that `--secret` is visible in process listings",
    ],
    stack: "TypeScript, Node readline, Vitest",
  },
  {
    title: "fix(cli): serialize writes to the session store",
    labels: ["bug", "size/medium", "points/150", "area/cli"],
    summary:
      "`fileSessionStore.save` loads the whole JSON document, mutates it and writes it back with no lock. Two concurrent `acquire` commands can read the same snapshot and lose one session.",
    motivation:
      "Parallel CI jobs and a terminal running two acquires for different services hit this race easily, and the lost lease is invisible until `env` cannot find it.",
    files: "`packages/cli/src/commands/lease.ts`, `packages/cli/src/commands/lease.test.ts`",
    tasks: [
      "Serialize read-modify-write per path within the process and use an atomic temp-file rename",
      "Use an exclusive lock file with a short timeout for cross-process safety",
      "Retry once on a stale lock and surface a clear error if it persists",
      "Test two concurrent saves and assert both sessions survive",
      "Document the store as a local cache with best-effort locking",
    ],
    stack: "TypeScript, Node fs, Vitest",
  },
];
