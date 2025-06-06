import {
  decodeAddressHook,
  encodeAddressHook,
} from '@agoric/cosmic-proto/address-hooks.js';
import {
  type Amount,
  AmountMath,
  type Issuer,
  type NatAmount,
  type NatValue,
  type Purse,
} from '@agoric/ertp';
import { divideBy, multiplyBy, parseRatio } from '@agoric/ertp/src/ratio.js';
import { AddressHookShape } from '@agoric/fast-usdc/src/type-guards.js';
import type {
  CctpTxEvidence,
  FeeConfig,
  PoolMetrics,
} from '@agoric/fast-usdc/src/types.ts';
import { makeFeeTools } from '@agoric/fast-usdc/src/utils/fees.js';
import { mustMatch } from '@agoric/internal';
import { eventLoopIteration } from '@agoric/internal/src/testing-utils.js';
import {
  type Publisher,
  type Subscriber,
  makePublishKit,
  observeIteration,
  subscribeEach,
} from '@agoric/notifier';
import type {
  Bech32Address,
  ChainHub,
  CosmosChainInfo,
} from '@agoric/orchestration';
import fetchedChainInfo from '@agoric/orchestration/src/fetched-chain-info.js';
import { ROOT_STORAGE_PATH } from '@agoric/orchestration/tools/contract-tests.ts';
import { buildVTransferEvent } from '@agoric/orchestration/tools/ibc-mocks.ts';
import { heapVowE as VE } from '@agoric/vow';
import type { Invitation, ZoeService } from '@agoric/zoe';
import type {
  Installation,
  Instance,
} from '@agoric/zoe/src/zoeService/utils.js';
import { setUpZoeForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { E, type ERef, type EReturn } from '@endo/eventual-send';
import { makePromiseKit } from '@endo/promise-kit';
import type { ExecutionContext } from 'ava';
import type { OperatorOfferResult } from '../src/exos/transaction-feed.ts';
import type { FastUsdcSF } from '../src/fast-usdc.contract.ts';
import * as contractExports from '../src/fast-usdc.contract.ts';
import { MockCctpTxEvidences } from './fixtures.ts';
import { setupFastUsdcTest, uusdcOnAgoric } from './supports.ts';

type FucContext = EReturn<typeof makeTestContext>;

/**
 * We pass around evidence along with a flag to indicate whether it should be
 * treated as risky for testing purposes.
 */
export interface TxWithRisk {
  evidence: CctpTxEvidence;
  isRisk: boolean;
}

export const agToNoble = fetchedChainInfo.agoric.connections['noble-1'];

const { add, isGTE, make, subtract, min } = AmountMath;

export const getInvitationProperties = async (
  zoe: ZoeService,
  invitation: Invitation,
) => {
  const invitationIssuer = E(zoe).getInvitationIssuer();
  const amount = await E(invitationIssuer).getAmountOf(invitation);
  return amount.value[0];
};

// Spec for Mainnet. Other values are covered in unit tests of TransactionFeed.
export const operatorQty = 3;

const startContract = async (
  common: Pick<
    EReturn<typeof setupFastUsdcTest>,
    'brands' | 'commonPrivateArgs' | 'utils'
  >,
) => {
  const {
    brands: { usdc },
    commonPrivateArgs,
  } = common;

  let contractBaggage;
  const setJig = ({ baggage }) => {
    contractBaggage = baggage;
  };

  const { zoe, bundleAndInstall } = await setUpZoeForTest({ setJig });
  const installation: Installation<FastUsdcSF> =
    await bundleAndInstall(contractExports);

  const startKit = await E(zoe).startInstance(
    installation,
    { USDC: usdc.issuer },
    { usdcDenom: uusdcOnAgoric },
    // @ts-expect-error XXX contract expecting CosmosChainInfo with bech32
    // prefix but the Orchestration setup doesn't have it. The tests pass anyway
    // so we elide this infidelity to production.
    commonPrivateArgs,
  );

  const terms = await E(zoe).getTerms(startKit.instance);

  const { subscriber: metricsSub } = E.get(
    E.get(E(startKit.publicFacet).getPublicTopics()).poolMetrics,
  );

  const opInvs = await Promise.all(
    [...Array(operatorQty).keys()].map(opIx =>
      E(startKit.creatorFacet).makeOperatorInvitation(`operator-${opIx}`),
    ),
  );
  const { agoric, noble } = commonPrivateArgs.chainInfo;
  const agoricToNoble = (agoric as CosmosChainInfo).connections![noble.chainId];
  await E(startKit.creatorFacet).connectToNoble(
    agoric.chainId,
    noble.chainId,
    agoricToNoble,
  );
  await E(startKit.creatorFacet).publishAddresses();

  return {
    ...startKit,
    contractBaggage,
    terms,
    zoe,
    metricsSub,
    invitations: { operator: opInvs },
  };
};
export const makeTestContext = async (t: ExecutionContext) => {
  const common = await setupFastUsdcTest(t);
  await E(common.mocks.ibcBridge).setAddressPrefix('noble');

  const startKit = await startContract(common);

  const { transferBridge } = common.mocks;
  const evm = makeEVM();

  const { inspectBankBridge, inspectLocalBridge } = common.utils;
  const snapshot = () => ({
    bank: inspectBankBridge().length,
    local: inspectLocalBridge().length,
  });
  const since = ix => ({
    bank: inspectBankBridge().slice(ix.bank),
    local: inspectLocalBridge().slice(ix.local),
  });

  const sync = {
    ocw: makePromiseKit<EReturn<typeof makeOracleOperator>[]>(),
    lp: makePromiseKit<Record<string, ReturnType<typeof makeLP>>>(),
  };

  const { brands, utils } = common;
  const { bankManager } = common.bootstrap;
  const receiveUSDCAt = async (
    addr: string,
    amount: NatValue,
  ): Promise<NatAmount> => {
    const pmt = await utils.pourPayment(make(brands.usdc.brand, amount));
    const purse = E(E(bankManager).getBankForAddress(addr)).getPurse(
      brands.usdc.brand,
    );
    return E(purse).deposit(pmt);
  };

  const accountsData = common.bootstrap.storage.data.get(ROOT_STORAGE_PATH);
  const { settlementAccount, poolAccount } = JSON.parse(
    JSON.parse(accountsData!).values[0],
  );
  t.is(settlementAccount, 'agoric1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc09z0g');
  t.is(poolAccount, 'agoric1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7zqht');
  const mint = async (e: CctpTxEvidence): Promise<NatAmount> => {
    const rxd = await receiveUSDCAt(settlementAccount, e.tx.amount);
    await VE(transferBridge).fromBridge(
      buildVTransferEvent({
        receiver: e.aux.recipientAddress,
        target: settlementAccount,
        sourceChannel: agToNoble.transferChannel.counterPartyChannelId,
        denom: 'uusdc',
        amount: e.tx.amount,
        sender: e.tx.forwardingAddress,
      }),
    );
    await eventLoopIteration(); // let settler do work
    return rxd;
  };

  /** local to test env, distinct from contract */
  const { chainHub } = common.facadeServices;
  chainHub.registerChain('agoric', fetchedChainInfo.agoric);
  chainHub.registerChain('dydx', fetchedChainInfo.dydx);
  chainHub.registerChain('osmosis', fetchedChainInfo.osmosis);
  chainHub.registerChain('noble', fetchedChainInfo.noble);

  return {
    bridges: { snapshot, since },
    common,
    evm,
    mint,
    startKit,
    sync,
    addresses: { settlementAccount, poolAccount },
  };
};
export const purseOf =
  (issuer: Issuer, { pourPayment }) =>
  async (value: bigint) => {
    const brand = await E(issuer).getBrand();
    const purse = E(issuer).makeEmptyPurse();
    const pmt = await pourPayment(make(brand, value));
    await E(purse).deposit(pmt);
    return purse;
  };

export const makeOracleOperator = async (
  opInv: Invitation<OperatorOfferResult>,
  txSubscriber: Subscriber<TxWithRisk>,
  zoe: ZoeService,
  t: ExecutionContext,
) => {
  let done = 0;
  const failures = [] as any[];
  t.like(await getInvitationProperties(zoe, opInv), {
    description: 'oracle operator invitation',
  });

  const offerResult = await E(E(zoe).offer(opInv)).getOfferResult();
  t.deepEqual(Object.keys(offerResult), ['invitationMakers', 'operator']);
  const { invitationMakers } = offerResult;

  let active = true;

  return harden({
    watch: () => {
      void observeIteration(subscribeEach(txSubscriber), {
        updateState: ({ evidence, isRisk }) => {
          if (!active) {
            return;
          }
          // KLUDGE: tx wouldn't include aux. OCW looks it up
          return E.when(
            E(invitationMakers).SubmitEvidence(
              evidence,
              isRisk ? { risksIdentified: ['RISK1'] } : {},
            ),
            inv =>
              E.when(E(E(zoe).offer(inv)).getOfferResult(), res => {
                t.is(res, 'inert; nothing should be expected from this offer');
                done += 1;
              }),
            reason => {
              failures.push(reason.message);
            },
          );
        },
      });
    },
    getDone: () => done,
    getFailures: () => harden([...failures]),
    // operator only gets .invitationMakers
    getKit: () => offerResult,
    setActive: flag => {
      active = flag;
    },
  });
};
const logAmt = amt => [
  Number(amt.value),
  //   numberWithCommas(Number(amt.value)),
  amt.brand
    .toString()
    .replace(/^\[object Alleged:/, '')
    .replace(/ brand]$/, ''),
];
const scaleAmount = (frac: number, amount: Amount<'nat'>) => {
  const asRatio = parseRatio(frac, amount.brand);
  return multiplyBy(amount, asRatio);
};

export const makeLP = async (
  name: string,
  usdcPurse: ERef<Purse>,
  zoe: ZoeService,
  instance: Instance<FastUsdcSF>,
) => {
  const publicFacet = E(zoe).getPublicFacet(instance);
  const { subscriber } = E.get(
    E.get(E(publicFacet).getPublicTopics()).poolMetrics,
  );
  const terms = await E(zoe).getTerms(instance);
  const { USDC } = terms.brands;
  const sharePurse = E(terms.issuers.PoolShares).makeEmptyPurse();
  let investment = AmountMath.makeEmpty(USDC);
  const me = harden({
    deposit: async (t: ExecutionContext, qty: bigint) => {
      const {
        value: { shareWorth },
      } = await E(subscriber).getUpdateSince();
      const give = { USDC: make(USDC, qty) };
      const proposal = harden({
        give,
        want: { PoolShare: divideBy(give.USDC, shareWorth) },
      });
      t.log(name, 'deposits', ...logAmt(proposal.give.USDC));
      const toDeposit = await E(publicFacet).makeDepositInvitation();
      const payments = { USDC: await E(usdcPurse).withdraw(give.USDC) };
      const payout = await E(zoe)
        .offer(toDeposit, proposal, payments)
        .then(seat => E(seat).getPayout('PoolShare'))
        .then(pmt => E(sharePurse).deposit(pmt))
        .then(a => a as Amount<'nat'>);
      t.log(name, 'deposit payout', ...logAmt(payout));
      t.true(isGTE(payout, proposal.want.PoolShare));
      investment = add(investment, give.USDC);
    },

    withdraw: async (t: ExecutionContext, portion: number) => {
      const myShares = await E(sharePurse)
        .getCurrentAmount()
        .then(a => a as Amount<'nat'>);
      const give = { PoolShare: scaleAmount(portion, myShares) };
      const {
        value: { shareWorth },
      } = await E(subscriber).getUpdateSince();
      const myUSDC = multiplyBy(myShares, shareWorth);
      const myFees = subtract(myUSDC, investment);
      t.log(name, 'sees fees earned', ...logAmt(myFees));
      const proposal = harden({
        give,
        want: { USDC: multiplyBy(give.PoolShare, shareWorth) },
      });
      const pct = portion * 100;
      t.log(name, 'withdraws', pct, '%:', ...logAmt(proposal.give.PoolShare));
      const toWithdraw = await E(publicFacet).makeWithdrawInvitation();
      const usdcPmt = await E(sharePurse)
        .withdraw(proposal.give.PoolShare)
        .then(pmt => E(zoe).offer(toWithdraw, proposal, { PoolShare: pmt }))
        .then(async seat => {
          // be sure to collect refund
          void E(sharePurse).deposit(await E(seat).getPayout('PoolShare'));
          t.log(await E(seat).getOfferResult());
          return E(seat).getPayout('USDC');
        });
      const amt = await E(usdcPurse).deposit(usdcPmt);
      t.log(name, 'withdraw payout', ...logAmt(amt));
      t.true(isGTE(amt, proposal.want.USDC));
      // min() in case things changed between checking metrics and withdrawing
      investment = subtract(investment, min(amt, investment));
      return amt;
    },
  });
  return me;
};

export const makeEVM = (template = MockCctpTxEvidences.AGORIC_PLUS_OSMO()) => {
  let nonce = 0;

  const makeTx = (
    amount: bigint,
    recipientAddress: Bech32Address,
    nonceOverride?: number,
  ): CctpTxEvidence => {
    nonce += 1;

    const tx: CctpTxEvidence = harden({
      ...template,
      txHash: `0x00000${nonceOverride || nonce}`,
      blockNumber: template.blockNumber + BigInt(nonceOverride || nonce),
      tx: { ...template.tx, amount },
      // KLUDGE: CCTP doesn't know about aux; it would be added by OCW
      aux: { ...template.aux, recipientAddress },
    });
    return tx;
  };

  const txPub = makePublishKit<TxWithRisk>();

  return harden({ cctp: { makeTx }, txPub });
};

export const makeCustomer = (
  who: string,
  cctp: ReturnType<typeof makeEVM>['cctp'],
  txPublisher: Publisher<TxWithRisk>,
  feeConfig: FeeConfig, // TODO: get from vstorage (or at least: a subscriber)
  chainHub: ChainHub, // not something a customer would normally have, but needed to make an `AccountId`
) => {
  const USDC = feeConfig.flat.brand;
  const feeTools = makeFeeTools(feeConfig);
  const sent = [] as TxWithRisk[];

  const me = harden({
    checkPoolAvailable: async (
      t: ExecutionContext,
      want: NatValue,
      metricsSub: ERef<Subscriber<PoolMetrics>>,
    ) => {
      const { value: m } = await E(metricsSub).getUpdateSince();
      const { numerator: poolBalance } = m.shareWorth; // XXX awkward API?
      const enough = poolBalance.value > want;
      t.log(who, 'sees', poolBalance.value, enough ? '>' : 'NOT >', want);
      return enough;
    },
    sendFast: async (
      t: ExecutionContext<FucContext>,
      amount: bigint,
      EUD: string,
      isRisk = false,
      nonceOverride?: number,
    ) => {
      const { storage } = t.context.common.bootstrap;
      const accountsData = storage.data.get(ROOT_STORAGE_PATH);
      const { settlementAccount } = JSON.parse(
        JSON.parse(accountsData!).values[0],
      );
      const recipientAddress = encodeAddressHook(settlementAccount, { EUD });
      // KLUDGE: UI would ask noble for a forwardingAddress
      // "cctp" here has some noble stuff mixed in.
      const tx = cctp.makeTx(amount, recipientAddress, nonceOverride);
      t.log(who, 'signs CCTP for', amount, 'uusdc w/EUD:', EUD);
      txPublisher.publish({ evidence: tx, isRisk });
      sent.push({ evidence: tx, isRisk });
      await eventLoopIteration();
      return tx;
    },

    checkSent: (
      t: ExecutionContext<FucContext>,
      { bank = [] as any[], local = [] as any[] } = {},
      { forward = false, route = 'pfm' as 'pfm' | 'cctp' } = {},
    ) => {
      const next = sent.shift();
      if (!next) throw t.fail('nothing sent');
      const { evidence } = next;
      const decoded = decodeAddressHook(evidence.aux.recipientAddress);
      mustMatch(decoded, AddressHookShape);
      const { EUD } = decoded.query;

      // C3 - Contract MUST calculate AdvanceAmount by ...
      // Mostly, see unit tests for calculateAdvance, calculateSplit
      const toReceive = forward
        ? { value: evidence.tx.amount }
        : feeTools.calculateAdvance(
            AmountMath.make(USDC, evidence.tx.amount),
            chainHub.resolveAccountId(EUD),
          );

      if (forward) {
        t.log(who, 'waits for fallback / forward');
        t.deepEqual(bank, []); // no vbank GIVE / GRAB
      }

      const myMsg = local.find(lm => {
        if (lm.type !== 'VLOCALCHAIN_EXECUTE_TX') return false;
        const [{ '@type': msgTy, receiver, memo }] = lm.messages;
        if (msgTy !== '/ibc.applications.transfer.v1.MsgTransfer') return false;
        if (route === 'pfm') {
          return JSON.parse(memo).forward.receiver === EUD;
        } else if (cctp) {
          const intermediate = 'noble1test';
          return receiver === intermediate;
        } else {
          // XXX support transfers to agoric?
          return receiver === EUD;
        }
      });
      if (!myMsg) {
        if (forward) return;
        throw t.fail(`no MsgTransfer to ${EUD}`);
      }
      const { poolAccount } = t.context.addresses;
      t.is(myMsg.address, poolAccount, 'advance sent from pool account');
      const [ibcTransferMsg] = myMsg.messages;
      // C4 - Contract MUST release funds to the end user destination address
      // in response to invocation by the off-chain watcher that
      // an acceptable Fast USDC Transaction has been initiated.
      t.deepEqual(
        ibcTransferMsg.token,
        { amount: String(toReceive.value), denom: uusdcOnAgoric },
        'C4',
      );
      t.log(who, 'sees', ibcTransferMsg.token, 'sending to', EUD);
      t.is(
        ibcTransferMsg.sourceChannel,
        fetchedChainInfo.agoric.connections['noble-1'].transferChannel
          .channelId,
        'expect routing through Noble',
      );
      // XXX for cctp: caller should check EUD, amount in IBC bridge
      return next;
    },
  });
  return me;
};
