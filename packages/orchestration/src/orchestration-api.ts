/**
 * @file General API of orchestration
 * - must not have chain-specific types without runtime narrowing by chain id
 * - should remain relatively stable.
 */
import type { Amount, Brand, NatAmount } from '@agoric/ertp/src/types.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- fails to notice the @see uses
import type { CurrentWalletRecord } from '@agoric/smart-wallet/src/smartWallet.js';
import type { Timestamp } from '@agoric/time';
import type { QueryManyFn } from '@agoric/vats/src/localchain.js';
import type { ResolvedPublicTopic } from '@agoric/zoe/src/contractSupport/topics.js';
import type { Passable } from '@endo/marshal';
import type {
  AgoricChainMethods,
  CosmosChainAccountMethods,
  CosmosChainInfo,
  IBCMsgTransferOptions,
  KnownChains,
  LocalAccountMethods,
  ICQQueryFunction,
  KnownNamespace,
  NobleMethods,
  Bech32Address,
} from './types.js';
import type { ResolvedContinuingOfferResult } from './utils/zoe-tools.js';

/**
 * A denom that designates a path to a token type on some blockchain.
 *
 * Multiple denoms may designate the same underlying base denom (e.g., `uist`,
 * `uatom`) on different Chains or on the same Chain via different paths. On
 * Cosmos chains, all but the base denom are IBC style denoms, but that may vary
 * across other chains. All the denoms that designate the same underlying base
 * denom form an equivalence class, along with the unique Brand on the local
 * Chain. Some operations accept any member of the equivalence class to
 * effectively designate the corresponding token type on the target chain.
 */
export type Denom = string; // ibc/... or uist

// ??? when multiple Denoms provide paths to the same remote token type,
// should the brand be 1:1 with that equivalence class or each Denom?
/**
 * In many cases, either a denom string or a local Brand can be used to
 * designate a remote token type.
 */
export type DenomArg = Denom | Brand<'nat'>;

/**
 * Count of some fungible token on some blockchain.
 *
 * @see {@link Orchestrator.asAmount} to convert to an Amount surjectively
 */
export type DenomAmount = {
  denom: Denom;
  value: bigint; // Nat
};

/** Amounts can be provided as pure data using denoms or as ERTP Amounts */
export type AmountArg = DenomAmount | Amount<'nat'>;

/**
 * Per `chain_id` in CAIP-2. In that spec all chain IDs are scoped
 * (namespace:reference) but in the Cosmos ecosystem the namespace is implied
 * and they use `chain_id`/`chainId` for what CAIP-2 calls the `reference`. We
 * qualify the term here to avoid confusion.
 *
 * @see {@link https://chainagnostic.org/CAIPs/caip-2}
 */
export type CaipChainId = `${string}:${string}`;

/**
 * à la CAIP-10
 *
 *   account_id:        chain_id + ":" + account_address
 *   chain_id:          [-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32} (See [CAIP-2][])
 *   account_address:   [-.%a-zA-Z0-9]{1,128}
 *
 * @see {@link https://chainagnostic.org/CAIPs/caip-10}
 */
export type AccountId = `${CaipChainId}:${string}`;

/**
 * Specific to Cosmos chains
 * @see {AccountId} for universal account identifier
 */
export type CosmosChainAddress = {
  /** Within the Cosmos ecosystem. e.g. `agoric-3' or 'cosmoshub-4' */
  chainId: string;
  /** The address value used on-chain */
  value: Bech32Address;
  encoding: 'bech32';
};

/**
 * Info used to identify blockchains across ecosystems
 * @see {@link https://chainagnostic.org/CAIPs/caip-2}
 */
export interface BaseChainInfo<N extends KnownNamespace = KnownNamespace> {
  /** CAIP-2 namespace, e.g. 'cosmos', 'eip155' */
  namespace: N;
  /** CAIP-2 reference, `e.g. `1`, `agoric-3` */
  reference: N extends 'eip155' ? `${number}` : string;
  /**
   * Circle CCTP Destination Domain
   * @see {@link https://developers.circle.com/stablecoins/supported-domains}
   */
  cctpDestinationDomain?: number;
}

/**
 * Shape that `ChainHub` is expecting
 */
export type ChainInfo<N extends KnownNamespace = KnownNamespace> =
  N extends 'cosmos' ? CosmosChainInfo : BaseChainInfo<N>;

/**
 * A value that can be converted mechanically to an AccountId.
 * @see {@link ChainHub.resolveAccountId}
 */
export type AccountIdArg = AccountId | CosmosChainAddress;

export type Caip10Record = {
  namespace: string;
  reference: string;
  accountAddress: string;
};

/**
 * Object that controls an account on a particular chain.
 *
 * The methods available depend on the chain and its capabilities.
 */
export type OrchestrationAccount<CI extends Partial<ChainInfo>> =
  OrchestrationAccountCommon &
    (CI extends { chainId: string }
      ? CI['chainId'] extends `agoric${string}`
        ? LocalAccountMethods
        : CI['chainId'] extends `noble${string}`
          ? CosmosChainAccountMethods<CI> & NobleMethods
          : CosmosChainAccountMethods<CI>
      : object);

/**
 * An object for access the core functions of a remote chain.
 *
 * Note that "remote" can mean the local chain; it's just that
 * accounts are treated as remote/arms length for consistency.
 */
export interface Chain<CI extends Partial<ChainInfo>> {
  getChainInfo: () => Promise<CI>;

  // "makeAccount" suggests an operation within a vat
  // TODO: scope to { icaEnabled: true }. Currently, only scoped to `namespace: 'cosmos'` chains
  /**
   * Creates a new Orchestration Account on the current Chain.
   * @returns an object that controls the account
   */
  makeAccount: () => CI extends { chainId: string }
    ? Promise<OrchestrationAccount<CI>>
    : never;
  // FUTURE supply optional port object; also fetch port object

  query: CI extends { icqEnabled: true }
    ? ICQQueryFunction
    : CI extends { chainId: string }
      ? CI['chainId'] extends `agoric${string}`
        ? QueryManyFn
        : never
      : never;

  // TODO provide a way to get the local denom/brand/whatever for this chain
}

/**
 * Used with `orch.getDenomInfo('ibc/1234')`. See {@link Orchestrator.getDenomInfo}
 */
export interface DenomInfo<
  HoldingChain extends keyof KnownChains,
  IssuingChain extends keyof KnownChains,
> {
  /** The well-known Brand on Agoric for the direct asset */
  brand?: Brand;
  /** The Chain at which the argument `denom` exists (where the asset is currently held) */
  chain: Chain<KnownChains[HoldingChain]>;
  /** The Chain that is the issuer of the underlying asset */
  base: Chain<KnownChains[IssuingChain]>;
  /** the Denom for the underlying asset on its issuer chain */
  baseDenom: Denom;
}

/**
 * Provided in the callback to `orchestrate()`.
 */
export interface Orchestrator {
  /**
   * Get a Chain object for working with the given chain.
   *
   * @param {C} chainName name of the chain in KnownChains or the ChainHub backing the Orchestrator
   */
  getChain: <C extends string>(
    chainName: C,
  ) => Promise<
    Chain<C extends keyof KnownChains ? KnownChains[C] : any> &
      (C extends 'agoric' ? AgoricChainMethods : object)
  >;

  /**
   * For a denom, return information about a denom including the equivalent
   * local Brand, the Chain on which the denom is held, and the Chain that
   * issues the corresponding asset.
   * @param denom
   */
  getDenomInfo: <
    HoldingChain extends keyof KnownChains,
    IssuingChain extends keyof KnownChains,
  >(
    denom: Denom,
    srcChainName: HoldingChain,
  ) => DenomInfo<HoldingChain, IssuingChain>;

  /**
   * Convert an amount described in native data to a local, structured Amount.
   * @param amount - the described amount
   * @returns the Amount in local structuerd format
   */
  asAmount: (amount: DenomAmount) => NatAmount;
}

/**
 * An object that supports high-level operations for an account on a remote chain.
 */
export interface OrchestrationAccountCommon {
  /**
   * @returns the address of the account on the remote chain
   */
  getAddress: () => CosmosChainAddress;

  /**
   * @returns an array of amounts for every balance in the account.
   *
   * @throws when prohibited (see `icqEnabled` in {@link CosmosChainInfo})
   */
  getBalances: () => Promise<DenomAmount[]>;

  /**
   * @returns the balance of a specific denom for the account.
   *
   * @throws when prohibited (see `icqEnabled` in {@link CosmosChainInfo})
   */
  getBalance: (denom: DenomArg) => Promise<DenomAmount>;

  /**
   * Transfer amount to another account on the same chain. The promise settles when the transfer is complete.
   * @param toAccount - the account to send the amount to. MUST be on the same chain
   * @param amount - the amount to send
   * @returns void
   */
  send: (toAccount: AccountIdArg, amount: AmountArg) => Promise<void>;

  /**
   * Transfer multiple amounts to another account on the same chain. The promise settles when the transfer is complete.
   * @param toAccount - the account to send the amount to. MUST be on the same chain
   * @param amounts - the amounts to send
   * @returns void
   */
  sendAll: (
    toAccount: CosmosChainAddress,
    amounts: AmountArg[],
  ) => Promise<void>;

  /**
   * Transfer an amount to another account, typically on another chain.
   * The promise settles when the transfer is complete.
   * @param amount - the amount to transfer. Can be provided as pure data using denoms or as ERTP Amounts.
   * @param destination - the account to transfer the amount to.
   * @param [opts] - an optional memo to include with the transfer, which could drive custom PFM behavior, and timeout parameters
   * @returns void
   * @throws {Error} if route is not determinable, asset is not recognized, or
   * the transfer is rejected (insufficient funds, timeout)
   */
  transfer: (
    destination: AccountIdArg,
    amount: AmountArg,
    opts?: IBCMsgTransferOptions,
  ) => Promise<void>;

  /**
   * Transfer an amount to another account in multiple steps. The promise settles when
   * the entire path of the transfer is complete.
   * @param amount - the amount to transfer
   * @param msg - the transfer message, including follow-up steps
   * @returns void
   */
  transferSteps: (amount: AmountArg, msg: TransferMsg) => Promise<void>;

  /**
   * Returns `invitationMakers` and `publicSubscribers` to the account
   * holder's smart wallet so they can continue interacting with the account
   * and read account state in vstorage if published.
   */
  asContinuingOffer: () => Promise<ResolvedContinuingOfferResult>;

  /**
   * Public topics are a map to different vstorage paths and subscribers that
   * can be shared with on or offchain clients.
   * When returned as part of a continuing invitation, it will appear
   * in the {@link CurrentWalletRecord} in vstorage.
   */
  getPublicTopics: () => Promise<Record<string, ResolvedPublicTopic<unknown>>>;
}

/**
 * Flows to orchestrate are regular Javascript functions but have some
 * constraints to fulfill the requirements of resumability after termination of
 * the enclosing vat. Some requirements for each orchestration flow:
 * - must not close over any values that could change between invocations
 * - must satisfy the `OrchestrationFlow` interface
 * - must be hardened
 * - must not use `E()` (eventual send)
 *
 * The call to `orchestrate` using a flow function in reincarnations of the vat
 * must have the same `durableName` as before. To help enforce these
 * constraints, we recommend:
 *
 * - keeping flows in a `.flows.js` module
 * - importing them all with `import * as flows` to get a single object keyed by
 *   the export name
 * - using `orchestrateAll` to treat each export name as the `durableName` of
 *   the flow
 * - adopting `@agoric/eslint-config` that has rules to help detect problems
 */
export interface OrchestrationFlow<CT = unknown> {
  (orc: Orchestrator, ctx: CT, ...args: Passable[]): Promise<unknown>;
}

/**
 * Internal structure for TransferMsgs.
 * The type must be able to express transfers across different chains and transports.
 *
 * NOTE Expected to change, so consider an opaque structure.
 * @internal
 */
export interface TransferMsg {
  toAccount: CosmosChainAddress;
  timeout?: Timestamp;
  next?: TransferMsg;
  data?: object;
}

/** @alpha */
export interface AfterAction {
  destChain: string;
  destAddress: CosmosChainAddress;
}
/** @alpha */
export interface SwapExact {
  amountIn: Amount;
  amountOut: Amount;
}
/** @alpha */
export interface SwapMaxSlippage {
  amountIn: Amount;
  brandOut: Brand;
  slippage: number;
}
