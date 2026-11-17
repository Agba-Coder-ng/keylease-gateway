/** Proxy issues for the contributor batch. See scripts/create-issues.mjs. */
export const proxyIssues = [
  {
    title: "feat(proxy): make the maximum request body size configurable",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "`buildProxyServer` hardcodes a 32 MiB `bodyLimit`, so every deployment accepts exactly the same payloads. Add a `KEYLEASE_MAX_BODY_BYTES` setting (default 32 MiB) wired through `ResolvedConfig` into the Fastify instance.",
    motivation:
      "An upstream that accepts 100 MB uploads cannot be gated today, while a JSON API would rather reject a 40 MB body before the verifier and the RPC call run. A single hardcoded number satisfies neither.",
    files:
      "`packages/proxy/src/server.ts`, `packages/proxy/src/index.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Add `KEYLEASE_MAX_BODY_BYTES` to `ProxyEnv`/`ResolvedConfig` with validation (positive integer, sane upper bound)",
      "Thread it into `buildProxyServer` as an option and set `bodyLimit` from it",
      "Return a JSON `413 payload_too_large` body, not Fastify's default error shape",
      "Tests: a body one byte over the limit is rejected before verification; a body at the limit is forwarded",
      "Document the variable in the README proxy configuration table",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): strip client-supplied x-keylease-* headers before forwarding",
    labels: ["bug", "size/trivial", "points/100", "area/proxy", "security"],
    summary:
      "`buildUpstreamHeaders` forwards every non-hop-by-hop header except `authorization`. A caller can therefore send `x-keylease-calls-remaining: 999999` or any future `x-keylease-*` header straight to the upstream.",
    motivation:
      "If the upstream trusts `x-keylease-*` as proof that the proxy admitted the request, caller-controlled values are a spoofing primitive. Only the proxy may set those headers.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Drop every inbound header whose lowercased name starts with `x-keylease-` before building upstream headers",
      "Keep setting exactly `x-keylease-lease-id` and `x-keylease-calls-remaining` from the verified decision",
      "Test that a caller-supplied `x-keylease-*` value never reaches the injected `fetch`",
      "Add a note to the README responses section",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): cache terminal lease denials for a short window",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "The verifier only caches successful `get_lease` reads, so a token for a lease that does not exist costs one Soroban RPC simulation per request. Cache `LeaseNotFoundError` results for a short, separate TTL.",
    motivation:
      "A client retrying an old token can burn RPC quota and add latency for everyone. A missing lease will not appear retroactively, so remembering the denial for a few seconds is safe.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/cache.ts`",
    tasks: [
      "Cache not-found outcomes with a TTL capped at `min(cacheTtlMs, 5000)`",
      "Never cache transport, timeout or contract errors outside `LeaseNotFoundError`",
      "Test that repeated requests for an unknown lease id trigger exactly one provider call",
      "Expose the denial-cache behaviour in `stats()` or a comment so operators can reason about it",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): collapse concurrent lease lookups with single-flight",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "A cache miss for the same lease in concurrent requests produces one RPC simulation per request. Add an in-flight promise map so only the first caller talks to Soroban RPC and the rest await that result.",
    motivation:
      "Bursts on a cold proxy are exactly when RPC throttling hurts: hundreds of parallel requests for one lease multiply into hundreds of identical simulations.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/verifier.test.ts`",
    tasks: [
      "Track in-flight `getLeaseState` promises per lease id and reuse them",
      "Always clear the in-flight entry in `finally`, including on rejection",
      "Test with a deferred provider promise: 25 concurrent verifications produce one provider call",
      "Test that a rejected lookup is retried by the next request, not cached",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): retry failed quota commits with bounded backoff",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "`OnChainQuota.drain` requeues failed counts but does nothing until the next batch threshold or the 10s timer. On a quiet lease that can leave `calls_used` behind real traffic indefinitely.",
    motivation:
      "On-chain quota is the authoritative number for settlement. Retrying promptly, with jitter and a cap, keeps the chain close to reality without hammering RPC during an outage.",
    files: "`packages/proxy/src/quota.ts`, `packages/proxy/src/quota.test.ts`",
    tasks: [
      "Schedule a retry after a failure using exponential backoff with jitter",
      "Keep failed counts pending and never double-commit them",
      "Stop retrying after a configurable number of attempts and surface the failure through `onError`",
      "Tests use fake timers to assert the retry schedule and that one successful retry clears pending state",
    ],
    stack: "TypeScript, Vitest, fake timers",
  },
  {
    title: "feat(proxy): bound the number of leases tracked by the quota sink",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "`OnChainQuota.pending` grows with every distinct lease that serves traffic and has no cap. Add a tracked-lease bound plus a forced flush when it is reached.",
    motivation:
      "A long-lived gateway fronts many leases over its lifetime; an unbounded map is a slow memory leak and a denial-of-service vector for whoever holds many leases.",
    files: "`packages/proxy/src/quota.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Add `maxTrackedLeases` (default 10 000) to `OnChainQuotaOptions`",
      "When the bound is approached, flush before recording new leases; never drop uncommitted counts silently",
      "Report through `onError` when the bound forces an early flush",
      "Test the bound with a fake committer and assert every recorded call is eventually committed",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): stream upstream responses instead of buffering them",
    labels: ["enhancement", "size/high", "points/200", "area/proxy"],
    summary:
      "The handler awaits `response.arrayBuffer()` and sends the whole body at once. Forward `response.body` as a stream so large downloads and server-sent events do not sit in proxy memory.",
    motivation:
      "Buffering multiplies the body limit by the number of concurrent requests, and SSE or long downloads never reach the client until they finish upstream.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Pipe `response.body` to the Fastify reply with `Readable.fromWeb` (or equivalent) while preserving status and headers",
      "Keep the existing empty-body rules for HEAD, 204 and 304",
      "Cancel the upstream stream when the client disconnects",
      "Tests cover a multi-chunk response, a mid-stream client abort and header preservation",
    ],
    stack: "TypeScript, Node streams, Fastify, Vitest",
  },
  {
    title: "feat(proxy): optional per-lease request rate limit",
    labels: ["enhancement", "size/high", "points/200", "area/proxy", "security"],
    summary:
      "Quota limits the total calls a lease may make but not how fast it makes them: one lease can drain thousands of calls in seconds. Add a token-bucket rate limit per lease, disabled by default.",
    motivation:
      "A prepaid quota is not a burst licence. Providers gating a paid API need to protect their upstream from a single lease saturating it, without changing how much the lease may consume.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Add `KEYLEASE_RATE_LIMIT_PER_MINUTE` (0 = disabled) with validation",
      "Implement a per-lease token bucket with an injected clock and prune idle buckets",
      "Deny with `429 rate_limited` plus `Retry-After`, and do not consume quota for denied requests",
      "Tests cover refill, burst, Retry-After value and that quota is untouched on 429",
      "Document the variable and the new status code",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): propagate x-request-id through the proxy",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "Honour an inbound `x-request-id` (or mint one), forward it upstream and echo it on the response so a caller can correlate a denial with proxy logs.",
    motivation:
      "Debugging a denied call today means matching timestamps between caller and proxy. A request id makes one grep enough.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Accept a valid inbound `x-request-id` or generate one",
      "Replace values containing control characters or excessive length",
      "Include the id in denial logs and in the response",
      "Test the pass-through, generated and sanitised cases",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): shorten the cache TTL as a lease approaches expiry",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "Lease state is cached for a flat 30 seconds, so a request can be admitted up to 30s after the lease expired on chain. Cache until `min(cacheTtlMs, expiresAt - now)`.",
    motivation:
      "The proxy exists to enforce expiry. A blanket TTL trades correctness for RPC savings in exactly the window where correctness matters most.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/verifier.test.ts`",
    tasks: [
      "Compute the cache TTL per lease as `min(cacheTtlMs, expiresAt - now)` and skip caching when non-positive",
      "Keep the existing behaviour for long-lived leases",
      "Test with a fake clock that a lease expiring in 2s is re-fetched 2s later, not 30s later",
      "Cover the already-expired case so it is denied without a cache entry",
    ],
    stack: "TypeScript, Vitest, fake clock",
  },
  {
    title: "feat(proxy): bind each lease to the configured upstream service",
    labels: ["enhancement", "size/high", "points/200", "area/proxy", "security"],
    summary:
      "The proxy verifies that a lease exists and is active, but not that it was bought for the service this proxy protects. Add `KEYLEASE_SERVICE_ID` and deny a lease whose on-chain `service` differs.",
    motivation:
      "Without the binding, a lease on the cheapest registered service authorises traffic to any upstream the same contract serves, which breaks per-service pricing and the provider's revenue expectation.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Add optional `KEYLEASE_SERVICE_ID`; when set, compare it with `lease.service`",
      "Deny mismatches with `403 lease_service_mismatch` and document the code",
      "Do not reuse a cached state under a different service binding",
      "Tests cover matching, mismatching and unset configurations",
      "README: explain that omitting the variable restores the current permissive behaviour",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): configure trustProxy so x-forwarded-for cannot be spoofed",
    labels: ["bug", "size/trivial", "points/100", "area/proxy", "security"],
    summary:
      "Fastify runs without `trustProxy`, so `request.protocol` and `request.ip` ignore the real edge. Behind a load balancer the proxy also appends a caller-supplied `x-forwarded-for` to the upstream chain.",
    motivation:
      "Today any client can choose the `x-forwarded-for` value the upstream sees, and `request.protocol` is always `http` even when TLS terminates at a balancer.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Add `KEYLEASE_TRUST_PROXY` (false by default, `true` or a hop count/CIDR list)",
      "Set `trustProxy` in the Fastify options and derive `x-forwarded-*` from the trusted values",
      "When trust is off, drop inbound `x-forwarded-*` instead of forwarding them",
      "Tests cover both modes and a spoofed header",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): reject WebSocket upgrade requests with 426",
    labels: ["bug", "size/trivial", "points/100", "area/proxy"],
    summary:
      "A request with `Connection: upgrade` and `Upgrade: websocket` currently reaches the handler, is verified, consumes a call, and fails inside `fetch`. Answer it explicitly with `426 upgrade_required`.",
    motivation:
      "An unclear 502 after quota was already spent is a bad failure mode for a client that expects a websocket. The proxy does not support upgrades, so it should say so before charging.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Detect upgrade requests before lease verification",
      "Respond `426` with a JSON body and an `Upgrade` header naming nothing supported",
      "Test that quota is not consumed for the rejected upgrade",
      "Document the limitation in the README responses table",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): preserve duplicate response headers other than set-cookie",
    labels: ["bug", "size/trivial", "points/100", "area/proxy"],
    summary:
      "`copyResponseHeaders` calls `reply.header(lower, value)` for each header iteration, so repeated `vary`, `link` or `warning` fields overwrite each other. Only `set-cookie` is handled specially.",
    motivation:
      "Dropped `vary` headers can poison caches in front of the upstream, and dropped `link` headers break pagination clients. Multi-valued response headers should survive the proxy.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Accumulate repeated header names and append instead of overwrite for the ones Fetch exposes repeatedly",
      "Keep `set-cookie` handled with `getSetCookie()` exactly as today",
      "Test a response with two `vary` values and two `set-cookie` values",
      "Note the behaviour in a comment near `copyResponseHeaders`",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): add configurable keep-alive and connection timeouts",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "The Fastify server has no explicit `connectionTimeout`, `keepAliveTimeout` or `requestTimeout`; the defaults are implicit and untunable. Expose them as environment variables.",
    motivation:
      "A proxy in front of a slow upstream needs a request timeout that matches the upstream contract, and a public edge needs short keep-alive windows to resist connections held open for slowloris-style attacks.",
    files: "`packages/proxy/src/index.ts`, `packages/proxy/src/server.ts`",
    tasks: [
      "Add `KEYLEASE_KEEP_ALIVE_TIMEOUT_MS` and `KEYLEASE_REQUEST_TIMEOUT_MS` with validation",
      "Pass both to Fastify and return `408 request_timeout` in JSON",
      "Tests cover the timeout firing and the config validation",
      "README env table updated",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): add an upstream circuit breaker",
    labels: ["enhancement", "size/high", "points/200", "area/proxy"],
    summary:
      "When the upstream is down, every request waits for the 15s timeout and fails, consuming quota along the way. Add a circuit breaker that fails fast with 503 after a failure threshold and probes for recovery.",
    motivation:
      "The proxy charges callers for upstream outages today. Failing fast both protects the upstream during recovery and avoids burning paid quota on requests that never succeeded.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Track consecutive upstream failures and open the circuit at a configurable threshold",
      "While open, return `503 upstream_unavailable` without consuming quota",
      "Half-open after a cooldown and close on the first success",
      "Tests use a fake clock and a fake fetch to cover open, half-open and close",
      "Document the new behaviour and any variables",
    ],
    stack: "TypeScript, Fastify, Vitest, fake clock",
  },
  {
    title: "feat(proxy): add Retry-After to verification_unavailable responses",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "A `503 verification_unavailable` currently tells the caller nothing about when to retry. Add a `Retry-After` header derived from the cache TTL or a small constant.",
    motivation:
      "Clients that respect `Retry-After` back off politely instead of retrying a dead RPC path in a tight loop, which makes an RPC incident worse.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Set `Retry-After` on every 503 produced by the verifier",
      "Choose a value that matches the configured cache TTL, capped at 30s",
      "Test the header on the RPC-down path",
      "Mention it in the README response table",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): answer CORS preflight OPTIONS without lease verification",
    labels: ["bug", "size/medium", "points/150", "area/proxy"],
    summary:
      "Browser preflight `OPTIONS` requests never carry `Authorization`, so they are denied with 401 and the real request is never sent. Handle preflight before verification.",
    motivation:
      "Any browser client gated by the proxy is unusable today, even with a valid token, because the browser refuses to send the actual request when preflight fails.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Detect a preflight by method plus `Access-Control-Request-Method` and answer 204",
      "Echo an allowlist of headers and origins from configuration instead of `*` when credentials are involved",
      "Do not consume quota for preflight",
      "Tests cover preflight with and without a token, and a normal OPTIONS request that still requires auth",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): stop LRU counter eviction from minting quota",
    labels: ["bug", "size/high", "points/200", "area/proxy", "security"],
    summary:
      "`LeaseVerifier.consume` evicts the oldest local counter at `maxCounters`. If that lease is used again, its local count restarts at zero and the proxy can serve calls that the on-chain `calls_used` does not reflect until the next commit.",
    motivation:
      "The local counter is a fast path over on-chain state; eviction must not become a way to spend quota twice. With many concurrent leases an attacker can push a victim's counter out of the map.",
    files: "`packages/proxy/src/verifier.ts`, `packages/proxy/src/verifier.test.ts`",
    tasks: [
      "Never drop a counter that has uncommitted quota, or flush its pending count before eviction",
      "Cap tracked counters by flushing through the quota sink instead of silently forgetting",
      "Test the eviction path with `maxCounters: 2` and prove no call is served twice",
      "Document the invariant in the verifier header comment",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): validate an upper bound for KEYLEASE_CACHE_TTL_MS",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "`KEYLEASE_CACHE_TTL_MS` accepts any positive number, including a year, which silently disables expiry enforcement in practice. Add a documented upper bound.",
    motivation:
      "A typo of `30000000` instead of `30000` is easy to miss and weakens the core safety property of the proxy. Configuration errors should fail at startup, loudly.",
    files: "`packages/proxy/src/index.ts`, `packages/proxy/src/index.test.ts`",
    tasks: [
      "Reject values above a documented maximum (e.g. 5 minutes) with `ProxyConfigError`",
      "Use the same helper for the quota flush interval and batch size",
      "Tests cover zero, negative, non-numeric and over-limit values",
      "README env table states the accepted range",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): log a secret-free configuration summary at startup",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "The proxy logs nothing at startup, so operators cannot confirm which upstream, network, contract and limits a running instance actually uses. Log a structured summary with the gateway secret reduced to a boolean.",
    motivation:
      "Most proxy misconfigurations are invisible until the first denied request. One startup line removes a debugging round trip and never exposes the seed.",
    files: "`packages/proxy/src/index.ts`",
    tasks: [
      "Log upstream, network, contract id, cache TTL, quota batch/flush and whether a gateway key is configured",
      "Never log `KEYLEASE_GATEWAY_SECRET` or the derived public key unless explicitly enabled",
      "Add a unit test around the summary builder",
      "Mention the line in the README operations notes",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): include request and response sizes in access logs",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "Denials are logged but allowed requests are not. Add a structured access log line with method, path, status, duration, lease id and byte counts.",
    motivation:
      "Operators need per-request evidence for quota disputes and latency regressions. The data is already available in the handler and in the response.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Log once per allowed request after the upstream response is sent",
      "Include `leaseId`, upstream status, duration and request/response byte counts",
      "Keep tokens and full query strings out of the log",
      "Test that the log payload redacts the bearer token",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "test(proxy): property-test header scrubbing against smuggling vectors",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy", "security"],
    summary:
      "`buildUpstreamHeaders` is the proxy's header boundary but is only covered by examples. Add table and property tests over hop-by-hop names, casing, duplicate values and CRLF-bearing values.",
    motivation:
      "Header handling is where request smuggling and auth leaks live. A property test that asserts no hop-by-hop header and no non-allowlisted `authorization` ever escapes gives lasting coverage.",
    files: "`packages/proxy/src/server.test.ts`, `packages/proxy/src/server.ts`",
    tasks: [
      "Generate random casing of every `HOP_BY_HOP_HEADERS` member and assert none are forwarded",
      "Assert `authorization` is dropped unless `forwardAuthorization` is true",
      "Cover multi-valued headers and values containing newlines (they must not reach `fetch`)",
      "Run the properties with a fixed seed so failures reproduce",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): forward an allowlist of request headers only",
    labels: ["enhancement", "size/high", "points/200", "area/proxy", "security"],
    summary:
      "The proxy forwards everything except hop-by-hop headers and authorization. Switch to an explicit allowlist (`accept`, `content-type`, `if-*`, `range`, vendor headers) with a documented escape hatch for extra names.",
    motivation:
      "A denylist cannot anticipate every header an upstream might over-trust, including future authentication or routing headers added by an edge. An allowlist makes the forwarded surface auditable.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Define a default allowlist and a `KEYLEASE_FORWARD_HEADERS` extension variable",
      "Keep setting the proxy-owned `x-keylease-*` and `x-forwarded-*` values explicitly",
      "Extend the existing header tests to assert the allowlist",
      "Document which headers reach the upstream and how to extend the list",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): expose the upstream timeout as an environment variable",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "`requestTimeoutMs` can only be set through the programmatic `buildProxyServer` option; `startProxy` always uses the 15s default. Add `KEYLEASE_UPSTREAM_TIMEOUT_MS`.",
    motivation:
      "Operators running the published binary cannot tune the timeout without patching code, even though the handler already supports `0` to disable it.",
    files: "`packages/proxy/src/index.ts`, `packages/proxy/src/server.ts`, `packages/proxy/src/index.test.ts`",
    tasks: [
      "Add `KEYLEASE_UPSTREAM_TIMEOUT_MS` with validation (0 disables)",
      "Pass it into `buildProxyServer` and document the default",
      "Test the env parsing and the 504 mapping",
      "README env table updated",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "test(proxy): cover HEAD, 204 and 304 empty-body forwarding",
    labels: ["enhancement", "size/trivial", "points/100", "area/proxy"],
    summary:
      "The handler has explicit empty-body handling for HEAD, 204 and 304, but no test proves the proxy never sends a body for those responses.",
    motivation:
      "Sending a body with a 204 breaks strict HTTP clients and can corrupt a keep-alive connection. The branch is small but load-bearing.",
    files: "`packages/proxy/src/server.test.ts`",
    tasks: [
      "Add tests for HEAD with an upstream body, plus 204 and 304",
      "Assert the response body is empty and the headers are preserved",
      "Assert the call was still counted once for HEAD",
      "Use an injected fetch returning the crafted responses",
    ],
    stack: "TypeScript, Vitest",
  },
  {
    title: "feat(proxy): cap in-flight upstream requests",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "The proxy accepts unlimited concurrent requests and opens one upstream request each. Add a semaphore with a configurable limit and a fast `503 proxy_overloaded` when it is full.",
    motivation:
      "Without a cap, a traffic spike turns into an upstream outage and unbounded memory growth from pending bodies. A bounded queue with an immediate failure is safer than waiting.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/index.ts`",
    tasks: [
      "Add `KEYLEASE_MAX_IN_FLIGHT` (0 = unlimited, default 0 for compatibility)",
      "Release the slot on success, failure and client abort",
      "Return `503 proxy_overloaded` with `Retry-After` when the limit is hit",
      "Tests cover the limit, slot release and that quota is not consumed when rejected",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): do not follow upstream redirects",
    labels: ["bug", "size/high", "points/200", "area/proxy", "security"],
    summary:
      "The default `fetch` follows redirects, so a compromised or misconfigured upstream can redirect the proxy to an internal host or another origin. Pass `redirect: \"manual\"` and forward the 3xx as-is.",
    motivation:
      "Following redirects from the upstream side turns the proxy into an SSRF hop and can leak the forwarded `x-keylease-*` headers to a host the operator never configured.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Set `redirect: \"manual\"` on the forwarded request",
      "Forward the 3xx status and `location` without rewriting it",
      "Test that a 302 from the fake upstream stays a 302 and no second fetch happens",
      "Add the behaviour to the README response table",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "feat(proxy): abort the upstream request when the client disconnects",
    labels: ["enhancement", "size/medium", "points/150", "area/proxy"],
    summary:
      "The upstream request is tied only to `AbortSignal.timeout`, so a caller that hangs up still holds an upstream connection and quota until the body is read.",
    motivation:
      "Mobile clients and retries disconnect constantly. Cancelling promptly frees upstream capacity, and quota semantics stay honest only if the request actually completed.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Combine the timeout signal with a signal aborted on the request socket closing",
      "Do not log a client abort as a proxy error",
      "Test with an injected fetch that observes `signal.aborted` after the client closes",
      "Decide and document whether an aborted request keeps its consumed call",
    ],
    stack: "TypeScript, Fastify, Vitest",
  },
  {
    title: "fix(proxy): keep content-encoding consistent with the forwarded body",
    labels: ["bug", "size/medium", "points/150", "area/proxy"],
    summary:
      "Node's `fetch` transparently decompresses `gzip` and `br` responses, but the proxy copies the upstream `content-encoding` header back to the caller, so clients can try to decode an already-decoded body.",
    motivation:
      "Wrong encoding metadata breaks clients and caches in ways that are hard to attribute to the proxy. Either forward the compressed bytes untouched or strip the encoding header.",
    files: "`packages/proxy/src/server.ts`, `packages/proxy/src/server.test.ts`",
    tasks: [
      "Decide between byte-transparent forwarding and header normalisation, and document the choice",
      "Do not send `content-encoding` when the body handed to Fastify is decoded",
      "Update `content-length` accordingly or omit it",
      "Test with a gzip upstream response using an injected fetch",
    ],
    stack: "TypeScript, Node, Fastify, Vitest",
  },
];
