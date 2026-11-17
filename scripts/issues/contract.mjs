/** Contract issues for the contributor batch. See scripts/create-issues.mjs. */
export const contractIssues = [
  {
    title: "fix(contract): stop a provider re-registering another provider's service",
    labels: ["bug", "size/high", "points/200", "area/contract", "security"],
    summary:
      "`register_service` writes `Service(service)` unconditionally. Any provider can call it with a service id another provider registered and take over the name, price and future lease payouts.",
    motivation:
      "Existing leases keep the original provider address, but every new lease created after the takeover pays the new one. That is a revenue hijack reachable with one transaction.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Load any existing service and reject a different provider with `Unauthorized`",
      "Allow the original provider to update only the price, or require a dedicated re-price entrypoint",
      "Tests: takeover attempt fails; the original provider can still update; existing leases are unaffected",
      "Document the ownership rule in the contract reference",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "fix(contract): use checked arithmetic in revoke and settle payouts",
    labels: ["bug", "size/high", "points/200", "area/contract", "security"],
    summary:
      "`revoke` and `settle` compute `price_paid * calls_used` (or the remaining calls) as raw `i128` multiplication. With release `overflow-checks = true`, a large escrow traps the call and the lease can never be settled.",
    motivation:
      "Escrow maths is the one place where a panic strands real value. `create_lease` already uses `checked_mul`; settlement should be just as defensive and return a typed error instead of trapping.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Replace the payout multiplications with `checked_mul` and map failure to `InvalidAmount`",
      "Prove `payable + refund == price_paid` in every branch",
      "Tests with `price_paid` near `i128::MAX` and with zero used calls",
      "Add a short comment explaining the rounding direction",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "fix(contract): extend persistent TTL when leases and services are read",
    labels: ["bug", "size/medium", "points/150", "area/contract"],
    summary:
      "TTL is extended only in `store_lease`/`register_service`. A lease or service that is read but never written for the storage window can expire and become `LeaseNotFound` while it is still conceptually valid.",
    motivation:
      "`get_lease` is the proxy's hot path. If reads do not bump TTL, an idle lease silently disappears from state and every request is denied with `lease_not_found`.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Extend TTL in `load_lease`/`load_service` (and config reads) when below `MIN_TTL`",
      "Keep the extension cheap on the simulated read path",
      "Test that a read after the threshold raises the entry's live-until ledger",
      "Document the read-side extension in the storage notes",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add a paginated lease index per consumer",
    labels: ["enhancement", "size/high", "points/200", "area/contract"],
    summary:
      "Leases are only addressable by numeric id. Add a per-consumer index (`Vec<u64>` or a linked list) written by `create_lease` and exposed through a paginated view.",
    motivation:
      "Consumers cannot discover what they own after losing `.keylease/sessions.json`, and the CLI cannot list leases without an external database. On-chain ownership should be enumerable.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add a `DataKey::ConsumerLeases(Address)` entry with TTL handling",
      "Expose `get_consumer_leases(consumer, start, limit) -> Vec<u64>`",
      "Bound the page size so one call cannot exceed the resource budget",
      "Tests: multiple consumers, pagination boundaries and a settled lease still listed",
      "Document the view and its ordering guarantee",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add a version view",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "Expose `version() -> u32` (or a `String`) returning the contract ABI version burned into the wasm, matching the crate version.",
    motivation:
      "The CLI and proxy currently infer compatibility from the wasm hash. An explicit version makes deploy verification and future migrations checkable in one simulated call.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add the entrypoint with a constant aligned to `Cargo.toml`",
      "Test the returned value",
      "Document the view in the contract reference table",
      "Note the compatibility policy for future bumps",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add a two-step admin transfer",
    labels: ["enhancement", "size/medium", "points/150", "area/contract", "security"],
    summary:
      "The admin address is fixed at `init`. Add `propose_admin(new_admin)` plus `accept_admin()` so a typo cannot permanently lock out gateway rotation.",
    motivation:
      "`set_gateway` is the only admin action today, and a wrong `init` admin means redeploying the contract and migrating every lease. A two-step handover is the standard safeguard.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Store a pending admin and require the new admin's auth to accept",
      "Reject proposals from non-admins and clear the pending value on accept",
      "Emit a `admin_proposed`/`admin_changed` event",
      "Tests cover success, unauthorised proposal and accepting twice",
      "Document the entrypoints and the event names",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add an admin emergency pause for new leases",
    labels: ["enhancement", "size/high", "points/200", "area/contract", "security"],
    summary:
      "Add `set_paused(bool)` (admin only) that blocks `create_lease` while leaving `use_call`, `revoke` and `settle` working so existing leases can still be served and paid out.",
    motivation:
      "If a pricing bug or exploit is discovered, the only current option is to redeploy, which abandons outstanding escrow. A pause stops new exposure without freezing redemptions.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add a paused flag to `Config` and a `Paused` error variant",
      "Reject `create_lease` while paused; keep settlement paths open",
      "Emit a pause/unpause event",
      "Tests prove existing leases can still be used and settled during a pause",
      "Document the operational semantics in the README and SECURITY scope",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): validate service id length and charset",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "`register_service` accepts any `String`, including empty values, control characters and megabyte-scale names stored as persistent keys.",
    motivation:
      "Service ids appear in CLI flags, proxy config and event topics. A bounded, printable charset prevents storage abuse and unrepresentable configuration.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Define limits (length and allowed characters) as constants",
      "Return a typed `InvalidService` error (or reuse `InvalidAmount` if the enum is frozen)",
      "Tests cover empty, too long, whitespace and control characters",
      "Document the rules in the contract reference",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): reject a lease whose consumer is the contract itself",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "`create_lease` accepts any address as consumer, including `env.current_contract_address()`, which would create escrow that can never be refunded to a real account.",
    motivation:
      "The transfer would move tokens from the contract to the contract, recording a lease with meaningless ownership. Cheap validation prevents a permanently stuck escrow.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Compare the consumer with `env.current_contract_address()` and return a typed error",
      "Add a test for the rejected case",
      "Check whether the gateway/admin addresses deserve the same guard and note the decision",
      "Document the constraint",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "fix(contract): guard expires_at against u64 overflow",
    labels: ["bug", "size/medium", "points/150", "area/contract"],
    summary:
      "`create_lease` computes `env.ledger().timestamp() + duration` without a checked add. A sufficiently large duration traps the call after escrow has been transferred.",
    motivation:
      "With `overflow-checks = true` the transaction panics; depending on ordering the transfer may already be applied, leaving a lease id that was never stored. Validation belongs before the token transfer.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Use `checked_add` and return `InvalidDuration` before moving any tokens",
      "Add an upper bound that keeps the expiry representable and sane",
      "Test `u64::MAX` and `u64::MAX - timestamp` durations",
      "Document the accepted duration range",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): assert quote rejects overflowing totals",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "`quote` uses `checked_mul` and returns `InvalidAmount`, but no test covers the overflow branch or the zero-calls rejection.",
    motivation:
      "The overflow guard is the only thing standing between a huge `calls` argument and a trapped simulation. It deserves an explicit regression test.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add a test with `price_per_call = i128::MAX` and `calls = 2`",
      "Add a zero-calls test and an unknown-service test",
      "Assert the exact error variants",
      "Keep the tests independent of ledger timing",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): property tests for the escrow invariants",
    labels: ["enhancement", "size/medium", "points/150", "area/contract", "security"],
    summary:
      "Add randomised tests asserting that for any calls/quota state the sum of provider payout and consumer refund equals `price_paid`, and that no path pays out twice.",
    motivation:
      "Settlement is the highest-value code in the repo. Example-based tests cover the cases the author thought of; invariants over random states cover the rest.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Generate random `calls_limit`, `calls_used` and `price_paid` within safe bounds",
      "Assert conserve-value, single-payout and rounding-toward-provider invariants",
      "Include the revoke path and the settle-after-expiry path",
      "Keep the seed fixed and the run time under a few seconds",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
  {
    title: "test(contract): cover every unauthorised entrypoint path",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract", "security"],
    summary:
      "Authorisation is enforced with `require_auth` throughout, but tests do not systematically assert that the wrong signer is rejected for `use_call`, `revoke`, `settle`-adjacent admin calls and `set_service_active`.",
    motivation:
      "Auth regressions are silent: the happy path still passes while anyone can spend someone else's quota. A negative test per entrypoint is cheap insurance.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add tests where a non-gateway calls `use_call` and a non-consumer calls `revoke`",
      "Cover `set_gateway` and `set_service_active` from the wrong account",
      "Assert the mock auth failure behaviour rather than an `Error` variant",
      "Group them under a clearly named module",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
  {
    title: "feat(contract): emit remaining calls in the use_call event",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "The `calls_committed` event publishes `calls_used` but not the remaining quota, so indexers must also read the lease. Publish a `(calls_used, remaining)` pair.",
    motivation:
      "Dashboards watching quota consumption need the remaining count; pairing the two values in the event removes an extra RPC read per event.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Change the event payload to include the remaining calls",
      "Keep the topic tuple unchanged so existing filters still match",
      "Update the event test and document the new payload",
      "Note the payload change in the README events section",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add a settle_many batch entrypoint",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "Settlement is permissionless but one lease per transaction. Add `settle_many(ids: Vec<u64>)` that settles a bounded batch and returns the settled leases.",
    motivation:
      "A gateway that served hundreds of leases during an outage leaves many expired leases to settle. Batching reduces fees and makes the cleanup atomic per batch.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Bound the batch length and return a typed error when exceeded",
      "Decide and document whether one bad id aborts the batch or is skipped",
      "Emit one event per settled lease",
      "Tests: mixed states, over-limit batch and a repeated id",
      "Expose the command through the CLI in a follow-up issue",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): support a guarded wasm upgrade",
    labels: ["enhancement", "size/high", "points/200", "area/contract", "security"],
    summary:
      "Add an admin-only `upgrade(new_wasm_hash)` using the Soroban deployer, with the current contract address preserved and events emitted.",
    motivation:
      "An immutable contract means a single bug forces a new address and a manual migration of every lease and service. A guarded upgrade keeps the escrow and the address.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/Cargo.toml`",
    tasks: [
      "Implement `upgrade` with admin auth and a `contract_updated` event",
      "Keep storage layout compatible with the current version",
      "Add a migration note and a test that state survives an upgrade in the test environment",
      "Document the risk model in SECURITY.md",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "fix(contract): require an initialised config in set_service_active",
    labels: ["bug", "size/trivial", "points/100", "area/contract"],
    summary:
      "`set_service_active` authenticates and loads the service before checking configuration, so an uninitialised contract reports a misleading error and performs auth work first.",
    motivation:
      "Error precedence matters for operators: `NotInitialized` is the actionable message when the contract was never set up.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Load the config first (or document why the current order is intentional)",
      "Add a test on an uninitialised contract",
      "Check other entrypoints for the same inconsistency",
      "Keep error variants unchanged",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): track a per-service lease counter",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "Only the global `lease_count` is stored. Add a per-service count so providers and dashboards can see demand without scanning every lease.",
    motivation:
      "Providers pricing a service need to know how many leases it attracts. An incrementing counter on `create_lease` is one integer of storage for a useful metric.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add the counter to the `Service` struct or a dedicated data key",
      "Expose it through `get_service` and increment it in `create_lease`",
      "Tests cover multiple services and re-registration",
      "Document the field in the contract reference",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): add a service registry iterator",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "Services can only be looked up by their exact id. Add a paginated list of registered service ids (and expose names through the CLI).",
    motivation:
      "A consumer-facing catalogue needs to enumerate what is for sale. Today the service ids live only in documentation and in whatever the deploy script registered.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Store service ids in a `Vec<String>` alongside the existing entries",
      "Expose `list_services(start, limit)` with a bounded page size",
      "Handle de-registration or explicitly document that ids are append-only",
      "Tests cover an empty registry, pagination and duplicate registration",
      "Add the corresponding CLI command in the CLI batch",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): cover TTL extension thresholds",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "`MIN_TTL`/`EXTEND_TO` are central to keeping leases alive, but tests do not assert that writes raise the live-until ledger or that reads keep entries above the threshold.",
    motivation:
      "A TTL regression is invisible until a lease disappears in production, long after the change merged.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Assert `env.storage().persistent().get_ttl` after writes and reads",
      "Use ledger manipulation to simulate an entry below the threshold",
      "Cover leases, services and the instance config",
      "Keep the assertions tolerant of SDK unit constants",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
  {
    title: "feat(contract): bound calls and duration in create_lease",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "`create_lease` accepts any `u32` call count and any `u64` duration. Very large values produce unpayable leases and storage/TTL edge cases; clamp them to documented maxima.",
    motivation:
      "A one-call lease is legitimate, a four-billion-call lease is a mistake. Explicit bounds turn a silent design limit into a typed error and protect the payout arithmetic.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Define realistic maxima for calls and duration",
      "Return `InvalidCalls`/`InvalidDuration` before the token transfer",
      "Test the boundary values and one unit beyond",
      "Document the maxima in the README and in the CLI validation",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): align revoke and settle rounding",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "`revoke` refunds `price_paid * remaining / limit` and `settle` pays `price_paid * used / limit`; both truncate toward zero, so the two paths must agree on who receives the rounding dust.",
    motivation:
      "A one-stroop disagreement between the two exit paths is a real accounting inconsistency, and it is easy to change one without the other.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Extract one payout helper used by both entrypoints",
      "Assert `payable + refund == price_paid` for non-divisible amounts",
      "Test a price that is not divisible by the call limit",
      "Document which side receives the remainder",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): assert AlreadySettled after revoke and settle",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "The double-payout guard is the core escrow invariant, but there is no explicit test that `revoke` then `settle` (and the reverse) returns `AlreadySettled` and moves no tokens.",
    motivation:
      "Paying twice is the worst possible contract bug. A direct regression test documents the guarantee instead of relying on the accounting test to imply it.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Capture balances before and after the second call",
      "Cover revoke -> settle, settle -> revoke and settle -> settle",
      "Assert `AlreadySettled` and unchanged balances",
      "Keep the test independent of TTL values",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
  {
    title: "feat(contract): require admin and gateway to be distinct at init",
    labels: ["enhancement", "size/medium", "points/150", "area/contract", "security"],
    summary:
      "`init` accepts the same address for `admin` and `gateway`. A single compromised key would then be able to rotate itself and mint quota. Reject or explicitly allow it.",
    motivation:
      "Role separation is the only reason `use_call` and `set_gateway` use different auth. A silent self-assignment collapses that boundary during deployment.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Decide between rejecting equality and documenting it as an option",
      "If rejected, add a typed error and a test",
      "Verify the deploy script uses distinct roles (see `deployments.json`)",
      "Document the roles in README and SECURITY.md",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): version the event payloads",
    labels: ["enhancement", "size/medium", "points/150", "area/contract"],
    summary:
      "Event topics and payloads have changed shape across revisions with no version marker, so indexers cannot tell which schema an event uses.",
    motivation:
      "Off-chain consumers (dashboards, accounting) break silently on a payload change. A schema version in the topic tuple makes decoding deterministic.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add a schema version to every event topic or a leading payload field",
      "Group the event constructors behind helper functions",
      "Tests assert topic and payload shape for each event",
      "Document the schema and the compatibility rule",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "feat(contract): let consumers extend a lease before expiry",
    labels: ["enhancement", "size/high", "points/200", "area/contract"],
    summary:
      "Add `extend_lease(lease_id, extra_calls, extra_duration)` that pulls the price of the added calls and extends `calls_limit`/`expires_at` under consumer auth, reusing the existing escrow.",
    motivation:
      "Renewing today means creating a second lease id and rotating every token. Extension keeps one lease id and lets a running proxy see the new quota on its next cache refresh.",
    files: "`contracts/keylease-core/src/lib.rs`, `contracts/keylease-core/src/test.rs`",
    tasks: [
      "Specify the semantics for settled/expired/inactive leases and reject them",
      "Transfer the additional price into escrow and update `price_paid`",
      "Emit a dedicated `lease_extended` event",
      "Tests cover successful extension, quota growth, expiry growth and unauthorised calls",
      "Document the entrypoint and its CLI follow-up",
    ],
    stack: "Rust, soroban-sdk 29, cargo test",
  },
  {
    title: "test(contract): golden tests for event topics and payloads",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "Event topics are hand-written symbol tuples in each entrypoint. Add tests that pin the exact topics and payloads for `init`, service, lease, quota, revoke and settle events.",
    motivation:
      "Off-chain consumers filter by topic string. A renamed topic silently stops indexing, which is hard to notice and harder to backfill.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Collect emitted events with the test environment and assert topics",
      "Assert the payload type and key values",
      "Fail the test with the observed topic on mismatch",
      "Document the event catalogue in the README",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
  {
    title: "test(contract): pin pause semantics for already-active leases",
    labels: ["enhancement", "size/trivial", "points/100", "area/contract"],
    summary:
      "Pausing a service only blocks `create_lease`. Write tests that prove existing leases can still call, revoke and settle while the service is inactive.",
    motivation:
      "The difference between deactivating a service and freezing its leases is a product decision. Tests are the only durable place to record it.",
    files: "`contracts/keylease-core/src/test.rs`",
    tasks: [
      "Add a test that deactivates a service with an active lease",
      "Assert `use_call`, `revoke` and `settle` still work for that lease",
      "Assert a new `create_lease` fails with `ServiceInactive`",
      "Add a sentence to the README contract reference",
    ],
    stack: "Rust, soroban-sdk testutils, cargo test",
  },
];
