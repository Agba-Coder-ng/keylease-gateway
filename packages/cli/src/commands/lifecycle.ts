/**
 * `keylease settle` and `keylease revoke` — the consumer side of the lease
 * lifecycle on `keylease-core`.
 *
 * Both entrypoints move real value out of the contract's escrow:
 *
 * * `settle` is permissionless and only succeeds once the lease expired or ran
 *   out of calls. The provider is paid for consumed calls, the consumer is
 *   refunded the remainder.
 * * `revoke` is consumer-authorised and returns the unused calls immediately.
 */
import type { Keypair } from '@stellar/stellar-sdk';
import { ContractCallError, SorobanClient, type LeaseState } from '../client/soroban.js';
import { parseConsumerSecret, type NetworkArgs } from './lease.js';
import type { CliIo } from '../index.js';

export interface SettleArgs extends NetworkArgs {
  lease: string;
  secret: string;
  json: boolean;
}

export interface RevokeArgs extends NetworkArgs {
  lease: string;
  secret: string;
  json: boolean;
}

export interface UseCallArgs extends NetworkArgs {
  lease: string;
  count: number;
  secret: string;
  json: boolean;
}

export interface SettleDeps {
  createClient?: (args: SettleArgs) => Pick<SorobanClient, 'settle'>;
}

export interface RevokeDeps {
  createClient?: (args: RevokeArgs) => Pick<SorobanClient, 'revoke'>;
}

export interface UseCallDeps {
  createClient?: (args: UseCallArgs) => Pick<SorobanClient, 'useCalls'>;
}

function defaultClient(args: NetworkArgs): SorobanClient {
  return SorobanClient.fromEnv({
    KEYLEASE_NETWORK: args.network,
    KEYLEASE_RPC_URL: args.rpc,
    KEYLEASE_CONTRACT_ID: args.contract,
  });
}

export function renderLeaseOutcome(
  action: 'settled' | 'revoked',
  lease: LeaseState,
  io: CliIo,
  json: boolean,
): void {
  if (json) {
    io.out(JSON.stringify({ action, ...lease }, null, 2));
    return;
  }
  const paidOut =
    lease.callsLimit === 0
      ? 0
      : Math.floor((lease.pricePaid * lease.callsUsed) / lease.callsLimit);
  const refunded = lease.pricePaid - paidOut;
  io.out(`Lease ${lease.leaseId} ${action}`);
  io.out(`  service     : ${lease.service}`);
  io.out(`  consumer    : ${lease.consumer}`);
  io.out(`  provider    : ${lease.provider}`);
  io.out(`  calls used  : ${lease.callsUsed}/${lease.callsLimit}`);
  io.out(`  paid out    : ${paidOut} (to provider)`);
  io.out(`  refunded    : ${refunded} (to consumer)`);
}

/** `keylease settle --lease <id> --secret <key>` */
export async function settleCommand(
  args: SettleArgs,
  io: CliIo,
  deps: SettleDeps = {},
): Promise<number> {
  const signer: Keypair = parseConsumerSecret(args.secret);
  const client = deps.createClient ? deps.createClient(args) : defaultClient(args);
  const lease = await client.settle(args.lease, signer);
  renderLeaseOutcome('settled', lease, io, args.json);
  return 0;
}

/**
 * Translates a failed `use_call` into operator guidance. Only the account the
 * contract was initialised with may commit calls, so an auth failure and the
 * contract's `Unauthorized` variant both deserve an explicit message.
 */
export function describeUseCallError(error: unknown, leaseId: string): string | null {
  if (error instanceof ContractCallError) {
    switch (error.code) {
      case 14:
        return 'the signer is not the registered gateway for this contract (Unauthorized); pass the gateway account\'s --secret';
      case 7:
        return `lease ${leaseId} has expired; calls can no longer be committed`;
      case 6:
        return `lease ${leaseId} is no longer active (revoked or settled)`;
      case 5:
        return `lease ${leaseId} was not found on chain`;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthori[sz]ed|require_auth|not authorized|auth(?:entication)?[ _-]?fail/i.test(message)) {
    return 'the signer is not the registered gateway for this contract; pass the gateway account\'s --secret';
  }
  return null;
}

/**
 * `keylease use-call --lease <id> --count <n> --secret <gateway-key>`
 *
 * Manually commits served calls on chain. This spends quota without serving a
 * call and is intended for reconciling after a proxy outage.
 */
export async function useCallCommand(
  args: UseCallArgs,
  io: CliIo,
  deps: UseCallDeps = {},
): Promise<number> {
  const gateway: Keypair = parseConsumerSecret(args.secret);
  const client = deps.createClient ? deps.createClient(args) : defaultClient(args);

  let lease: LeaseState;
  try {
    lease = await client.useCalls(args.lease, args.count, gateway);
  } catch (error) {
    const guidance = describeUseCallError(error, args.lease);
    if (guidance !== null) throw new Error(guidance);
    throw error;
  }

  if (args.json) {
    io.out(
      JSON.stringify(
        {
          lease_id: lease.leaseId,
          committed: args.count,
          calls_used: lease.callsUsed,
          calls_limit: lease.callsLimit,
          remaining_calls: Math.max(0, lease.callsLimit - lease.callsUsed),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  io.out(`Committed ${args.count} call${args.count === 1 ? '' : 's'} on lease ${lease.leaseId}`);
  io.out(`  service     : ${lease.service}`);
  io.out(`  calls used  : ${lease.callsUsed}/${lease.callsLimit}`);
  io.out(`  remaining   : ${Math.max(0, lease.callsLimit - lease.callsUsed)}`);
  return 0;
}

/** `keylease revoke --lease <id> --secret <key>` */
export async function revokeCommand(
  args: RevokeArgs,
  io: CliIo,
  deps: RevokeDeps = {},
): Promise<number> {
  const signer: Keypair = parseConsumerSecret(args.secret);
  const client = deps.createClient ? deps.createClient(args) : defaultClient(args);
  const lease = await client.revoke(args.lease, signer);
  renderLeaseOutcome('revoked', lease, io, args.json);
  return 0;
}
