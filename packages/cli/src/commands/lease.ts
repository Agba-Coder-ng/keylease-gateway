import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Keypair } from '@stellar/stellar-sdk';
import { mintSessionToken } from '../token.js';
import { SorobanClient, type CreateLeaseResult } from '../client/soroban.js';
import type { CliIo } from '../index.js';

/** Where acquired leases are remembered so `keylease env` can find them. */
export const SESSION_STORE_PATH = '.keylease/sessions.json';

export interface NetworkArgs {
  network?: string | undefined;
  rpc?: string | undefined;
  contract?: string | undefined;
}

export interface AcquireArgs extends NetworkArgs {
  service: string;
  calls: number;
  duration: number;
  secret: string | undefined;
  json: boolean;
}

export interface EnvArgs {
  service: string;
  file: string;
  json: boolean;
}

/** A locally stored lease session produced by `keylease acquire`. */
export interface LeaseSession {
  service: string;
  leaseId: string;
  consumer: string;
  token: string;
  callsLimit: number;
  issuedAt: number;
  expiresAt: number;
  txHash: string | null;
  network: string;
}

export interface SessionStore {
  load(): Promise<Record<string, LeaseSession>>;
  save(session: LeaseSession): Promise<void>;
  saveAll(sessions: Record<string, LeaseSession>): Promise<void>;
}

export class SessionStoreError extends Error {
  constructor(
    readonly code: 'missing' | 'corrupt' | 'unreadable',
    path: string,
  ) {
    const guidance =
      code === 'missing'
        ? 'Run `keylease acquire` to create a stored lease.'
        : code === 'corrupt'
          ? 'Back up or repair the file, then run this command again.'
          : 'Check file permissions and try again.';
    super(`Cannot read session store at ${path}: ${code}. ${guidance}`);
    this.name = 'SessionStoreError';
  }
}

export interface AcquireDeps {
  createClient?: (args: AcquireArgs) => Pick<SorobanClient, 'createLease'>;
  store?: SessionStore;
  now?: () => number;
  readSecretFromStdin?: () => Promise<string>;
}

export interface EnvDeps {
  store?: SessionStore;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, contents: string) => Promise<void>;
}

function isLeaseSession(value: unknown): value is LeaseSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session['service'] === 'string' &&
    typeof session['leaseId'] === 'string' &&
    typeof session['consumer'] === 'string' &&
    typeof session['token'] === 'string' &&
    typeof session['callsLimit'] === 'number' &&
    Number.isFinite(session['callsLimit']) &&
    typeof session['issuedAt'] === 'number' &&
    Number.isFinite(session['issuedAt']) &&
    typeof session['expiresAt'] === 'number' &&
    Number.isFinite(session['expiresAt']) &&
    (typeof session['txHash'] === 'string' || session['txHash'] === null) &&
    typeof session['network'] === 'string'
  );
}

/** File-backed store, one JSON document keyed by service id. */
export function fileSessionStore(cwd: string = process.cwd()): SessionStore {
  const path = isAbsolute(SESSION_STORE_PATH)
    ? SESSION_STORE_PATH
    : join(cwd, SESSION_STORE_PATH);

  return {
    async load(): Promise<Record<string, LeaseSession>> {
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        throw new SessionStoreError(code === 'ENOENT' ? 'missing' : 'unreadable', path);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new SessionStoreError('corrupt', path);
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SessionStoreError('corrupt', path);
      }
      const sessions: Record<string, LeaseSession> = {};
      for (const [service, session] of Object.entries(parsed)) {
        if (!isLeaseSession(session)) throw new SessionStoreError('corrupt', path);
        sessions[service] = session;
      }
      return sessions;
    },
    async save(session: LeaseSession): Promise<void> {
      let sessions: Record<string, LeaseSession>;
      try {
        sessions = await this.load();
      } catch (error) {
        if (!(error instanceof SessionStoreError) || error.code !== 'missing') throw error;
        sessions = {};
      }
      sessions[session.service] = session;
      await this.saveAll(sessions);
    },
    async saveAll(sessions: Record<string, LeaseSession>): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

/**
 * Resolves the consumer secret with precedence: flag value > KEYLEASE_SECRET env var > stdin.
 * If secret is '-', reads one line from stdin without echoing (like `read -s`).
 * If secret is undefined, checks KEYLEASE_SECRET environment variable.
 * If neither is provided, reads from stdin.
 * 
 * @param secretArg - The --secret flag value (may be '-' for stdin or undefined for env/stdin fallback)
 * @param deps - Optional dependencies for reading from stdin (used for testing)
 */
export async function resolveConsumerSecret(
  secretArg: string | undefined,
  deps?: { readSecretFromStdin?: () => Promise<string> },
): Promise<string> {
  // Precedence 1: --secret flag value (except '-' which means stdin)
  if (secretArg && secretArg !== '-') {
    return secretArg;
  }

  // Precedence 2: KEYLEASE_SECRET environment variable
  const envSecret = process.env['KEYLEASE_SECRET'];
  if (envSecret && secretArg !== '-') {
    return envSecret;
  }

  // Precedence 3 or fallback: Read from stdin without echoing
  const reader = deps?.readSecretFromStdin ?? readSecretFromStdin;
  return reader();
}

/**
 * Reads one line from stdin without echoing, similar to `read -s` in bash.
 */
export async function readSecretFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr, // Write prompts to stderr to keep stdout clean
    });

    // Disable echo on the input stream
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    rl.question('', (secret) => {
      // Restore normal mode and output a newline
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stderr.write('\n');
      rl.close();
      resolve(secret);
    });

    // Handle errors
    rl.on('error', (error) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
      reject(error);
    });
  });
}

export function parseConsumerSecret(secret: string): Keypair {
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error('--secret must be a valid Stellar secret seed (starts with "S")');
  }
}

function defaultCreateClient(args: AcquireArgs): Pick<SorobanClient, 'createLease'> {
  return SorobanClient.fromEnv({
    KEYLEASE_NETWORK: args.network,
    KEYLEASE_RPC_URL: args.rpc,
    KEYLEASE_CONTRACT_ID: args.contract,
  });
}

function renderAcquireOutput(session: LeaseSession, io: CliIo, json: boolean): void {
  if (json) {
    io.out(
      JSON.stringify(
        {
          service: session.service,
          lease_id: session.leaseId,
          consumer: session.consumer,
          calls: session.callsLimit,
          issued_at: session.issuedAt,
          expires_at: session.expiresAt,
          tx_hash: session.txHash,
          session_token: session.token,
        },
        null,
        2,
      ),
    );
    return;
  }

  io.out(`Lease ${session.leaseId} acquired for service "${session.service}"`);
  io.out(`  consumer   : ${session.consumer}`);
  io.out(`  calls      : ${session.callsLimit} (prepaid into contract escrow)`);
  io.out(`  expires at : ${new Date(session.expiresAt * 1000).toISOString()}`);
  if (session.txHash) io.out(`  tx hash    : ${session.txHash}`);
  io.out('');
  io.out(`  Authorization: Bearer ${session.token}`);
}

/**
 * `keylease acquire --service <id> --calls <count> --duration <secs> [--secret <key>]`
 *
 * Invokes `create_lease` on `keylease-core`, then mints an ed25519-signed
 * session bearer token bound to `(lease_id, consumer)`.
 * 
 * Secret resolution (precedence: flag > env > stdin):
 * - If --secret is provided (and not '-'), use it directly
 * - If --secret - or not provided, check KEYLEASE_SECRET env var
 * - If env var is set, use it
 * - Otherwise, read from stdin without echoing
 */
export async function acquireCommand(
  args: AcquireArgs,
  io: CliIo,
  deps: AcquireDeps = {},
): Promise<number> {
  const secret = await resolveConsumerSecret(args.secret, {
    readSecretFromStdin: deps.readSecretFromStdin,
  });
  const consumer = parseConsumerSecret(secret);
  const createClient = deps.createClient ?? defaultCreateClient;
  const store = deps.store ?? fileSessionStore();
  const now = deps.now ?? (() => Date.now());

  const result: CreateLeaseResult = await createClient(args).createLease({
    service: args.service,
    calls: args.calls,
    duration: args.duration,
    consumer,
  });

  const issuedAt = Math.floor(now() / 1000);
  const expiresAt = issuedAt + args.duration;
  const token = mintSessionToken({
    leaseId: result.leaseId,
    consumerSecret: secret,
    issuedAt,
    expiresAt,
  });

  const session: LeaseSession = {
    service: args.service,
    leaseId: result.leaseId,
    consumer: consumer.publicKey(),
    token,
    callsLimit: args.calls,
    issuedAt,
    expiresAt,
    txHash: result.txHash,
    network: args.network ?? 'testnet',
  };

  await store.save(session);
  renderAcquireOutput(session, io, args.json);
  return 0;
}

/** The keys `keylease env` drops into the local `.env`. */
export function envEntriesFor(session: LeaseSession): Record<string, string> {
  return {
    KEYLEASE_SERVICE: session.service,
    KEYLEASE_LEASE_ID: session.leaseId,
    KEYLEASE_CONSUMER: session.consumer,
    KEYLEASE_SESSION_TOKEN: session.token,
    KEYLEASE_CALLS_LIMIT: String(session.callsLimit),
    KEYLEASE_ISSUED_AT: String(session.issuedAt),
    KEYLEASE_EXPIRES_AT: String(session.expiresAt),
  };
}

/**
 * Merges key/value pairs into existing `.env` text: unknown lines are kept
 * verbatim, previously set `KEY` are replaced in place, new keys appended.
 */
export function mergeEnv(existing: string, entries: Record<string, string>): string {
  const lines = existing.length > 0 ? existing.split('\n') : [];
  const emitted = new Set<string>();
  const out = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trimEnd());
    if (!match) return line;
    const key = match[1] as string;
    if (key in entries && !emitted.has(key)) {
      emitted.add(key);
      return `${key}=${entries[key]}`;
    }
    if (key in entries) return null; // drop duplicates
    return line;
  });

  // Drop the trailing blank line(s) of the original file before appending.
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }

  for (const [key, value] of Object.entries(entries)) {
    if (!emitted.has(key)) {
      emitted.add(key);
      out.push(`${key}=${value}`);
    }
  }

  const text = out.filter((line) => line !== null).join('\n').replace(/\n*$/, '\n');
  return text;
}

/**
 * `keylease env --service <id> [--file .env]`
 *
 * Writes the temporary session keys of a previously acquired lease into a local
 * `.env` file so shell tooling can pick them up.
 */
export async function envCommand(
  args: EnvArgs,
  io: CliIo,
  deps: EnvDeps = {},
): Promise<number> {
  const store = deps.store ?? fileSessionStore();
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const write =
    deps.writeFile ?? ((path: string, contents: string) => writeFile(path, contents, { mode: 0o600 }));

  const sessions = await store.load();
  const session = sessions[args.service];
  if (!session) {
    io.err(`no lease found for service "${args.service}"`);
    io.err('run: keylease acquire --service <id> --calls <n> --duration <secs> --secret <key>');
    return 1;
  }

  const entries = envEntriesFor(session);
  const existing = await read(args.file).catch(() => '');
  const merged = mergeEnv(existing, entries);
  await write(args.file, merged);

  const keys = Object.keys(entries);
  if (args.json) {
    io.out(JSON.stringify({ file: args.file, keys }, null, 2));
  } else {
    io.out(`Wrote ${keys.length} keys to ${args.file}`);
    io.out(`  ${keys.join(', ')}`);
  }
  return 0;
}
