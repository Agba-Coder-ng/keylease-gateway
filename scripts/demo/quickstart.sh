#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT_DIR/packages/cli/dist/index.js"
PROXY="$ROOT_DIR/packages/proxy/dist/index.js"
CONTRACT_ID="${KEYLEASE_CONTRACT_ID:-CC2YHTV3ZOFZJGQ5ACJAZRY46JDAF4ZUWOBMFZTSMQAFIW4UOXDA3KRC}"
WORK_DIR="$(mktemp -d)"
UPSTREAM_PID=""
PROXY_PID=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$PROXY_PID" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  if [[ -n "$UPSTREAM_PID" ]]; then
    kill "$UPSTREAM_PID" 2>/dev/null || true
    wait "$UPSTREAM_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for tool in node pnpm curl; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done

if [[ ! -t 0 ]]; then
  die 'run this script in an interactive terminal so the testnet secret can be entered without echo'
fi

read -r -s -p 'Funded Stellar testnet secret seed (input hidden): ' STELLAR_SECRET
printf '\n'
[[ "$STELLAR_SECRET" == S* ]] || die 'expected a Stellar secret seed beginning with S'

printf 'Building the CLI and proxy...\n'
if ! pnpm --filter @keylease/cli build >/dev/null 2>&1 ||
  ! pnpm --filter @keylease/proxy build >/dev/null 2>&1; then
  die 'build failed; run pnpm build outside the recording for details'
fi

printf '$ keylease acquire --network testnet --service weather-api --calls 5 --duration 3600 --secret [hidden]\n'
if ! (cd "$WORK_DIR" && node "$CLI" acquire \
  --network testnet \
  --contract "$CONTRACT_ID" \
  --service weather-api \
  --calls 5 \
  --duration 3600 \
  --secret "$STELLAR_SECRET" >/dev/null 2>&1); then
  die 'testnet lease acquisition failed; rerun outside the recording for details'
fi
unset STELLAR_SECRET
printf 'Lease acquired on Stellar Testnet.\n'

printf '$ keylease env --service weather-api --file .env\n'
if ! (cd "$WORK_DIR" && node "$CLI" env --service weather-api --file "$WORK_DIR/.env"); then
  die 'writing the demo .env failed'
fi
chmod 600 "$WORK_DIR/.env"

SESSION_TOKEN="$(sed -n 's/^KEYLEASE_SESSION_TOKEN=//p' "$WORK_DIR/.env")"
LEASE_ID="$(sed -n 's/^KEYLEASE_LEASE_ID=//p' "$WORK_DIR/.env")"
[[ -n "$SESSION_TOKEN" && -n "$LEASE_ID" ]] || die 'the generated .env is missing lease data'

pick_port() {
  node --input-type=module <<'NODE'
import { createServer } from 'node:net';
const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') process.stdout.write(String(address.port));
  server.close();
});
NODE
}

UPSTREAM_PORT="$(pick_port)"
while true; do
  PROXY_PORT="$(pick_port)"
  if [[ "$PROXY_PORT" != "$UPSTREAM_PORT" ]]; then
    break
  fi
done
node "$ROOT_DIR/scripts/demo/upstream.mjs" "$UPSTREAM_PORT" >"$WORK_DIR/upstream.log" 2>&1 &
UPSTREAM_PID=$!

wait_for_url() {
  local url="$1"
  local attempt
  for ((attempt = 0; attempt < 50; attempt += 1)); do
    if curl --silent --fail "$url" >/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

wait_for_url "http://127.0.0.1:$UPSTREAM_PORT/healthz" ||
  die 'local demo upstream did not start'

unset KEYLEASE_GATEWAY_SECRET
KEYLEASE_NETWORK=testnet \
KEYLEASE_CONTRACT_ID="$CONTRACT_ID" \
KEYLEASE_UPSTREAM_URL="http://127.0.0.1:$UPSTREAM_PORT" \
KEYLEASE_TRUST_PROXY=false \
HOST=127.0.0.1 \
PORT="$PROXY_PORT" \
  node "$PROXY" >"$WORK_DIR/proxy.log" 2>&1 &
PROXY_PID=$!
wait_for_url "http://127.0.0.1:$PROXY_PORT/healthz" ||
  die 'local proxy did not start; rerun outside the recording for details'

printf '\nLease %s is ready; the proxy is listening on port %s.\n' "$LEASE_ID" "$PROXY_PORT"
read -r -p 'Press Enter to send an allowed request... '
printf '\n$ curl -i -H "Authorization: Bearer [session token hidden]" http://localhost:%s/v1/weather\n' "$PROXY_PORT"
curl --silent --show-error --include \
  --header "Authorization: Bearer $SESSION_TOKEN" \
  "http://127.0.0.1:$PROXY_PORT/v1/weather"

read -r -p 'Press Enter to try a forged token... '
printf '\n$ curl -i -H "Authorization: Bearer kls1.forged.invalid" http://localhost:%s/v1/weather\n' "$PROXY_PORT"
curl --silent --show-error --include \
  --header 'Authorization: Bearer kls1.forged.invalid' \
  "http://127.0.0.1:$PROXY_PORT/v1/weather"

printf '\nDemo complete. The testnet lease is prepaid; its secret and session token were not printed.\n'
