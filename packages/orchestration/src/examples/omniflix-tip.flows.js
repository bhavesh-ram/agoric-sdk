import { NonNullish, makeTracer } from '@agoric/internal';
import { Fail, makeError, q } from '@endo/errors';
import { E } from '@endo/eventual-send';
import { M, mustMatch } from '@endo/patterns';

const trace = makeTracer('SwapAnything.Flow');

const { entries } = Object;

/**
 * @typedef {{
 *   destAddr: Bech32Address;
 *   receiverAddr: string;
 *   outDenom: Denom;
 *   slippage: { slippagePercentage: string; windowSeconds: number };
 *   onFailedDelivery: string;
 *   nextMemo?: string;
 * }} SwapInfo
 *
 * @import {GuestInterface, GuestOf} from '@agoric/async-flow';
 * @import {Denom} from '@agoric/orchestration';
 * @import {ZCFSeat} from '@agoric/zoe';
 * @import {Vow} from '@agoric/vow';
 * @import {LocalOrchestrationAccountKit} from '../exos/local-orchestration-account.js';
 * @import {ZoeTools} from '../utils/zoe-tools.js';
 * @import {Orchestrator, OrchestrationFlow, ChainHub, CosmosChainInfo, Bech32Address} from '../types.js';
 */

const denomForBrand = async (orch, brand) => {
  const agoric = await orch.getChain('agoric');
  const assets = await agoric.getVBankAssetInfo();
  const { denom } = NonNullish(
    assets.find(a => a.brand === brand),
    `${brand} not registered in ChainHub`,
  );
  return denom;
};

/**
 * @param {SwapInfo} swapInfo
 * @returns {string}
 */
const buildXCSMemo = swapInfo => {
  const memo = {
    wasm: {
      contract: swapInfo.destAddr,
      msg: {
        osmosis_swap: {
          output_denom: swapInfo.outDenom,
          slippage: {
            twap: {
              window_seconds: swapInfo.slippage.windowSeconds,
              slippage_percentage: swapInfo.slippage.slippagePercentage,
            },
          },
          receiver: swapInfo.receiverAddr,
          on_failed_delivery: swapInfo.onFailedDelivery,
          nextMemo: swapInfo.nextMemo,
        },
      },
    },
  };

  return JSON.stringify(memo);
};

/**
 * @satisfies {OrchestrationFlow}
 * @param {Orchestrator} orch
 * @param {object} ctx
 * @param {GuestInterface<ChainHub>} ctx.chainHub
 * @param {Promise<GuestInterface<LocalOrchestrationAccountKit['holder']>>} ctx.sharedLocalAccountP
 * @param {GuestInterface<ZoeTools>} ctx.zoeTools
 * @param {GuestOf<(msg: string, level?: string) => Vow<void>>} ctx.log
 * @param {ZCFSeat} seat
 * @param {SwapInfo} offerArgs
 */

// Ref: https://github.com/osmosis-labs/osmosis/tree/main/cosmwasm/contracts/crosschain-swaps#via-ibc
export const tipFlow = async (
  orch,
  {
    chainHub,
    sharedLocalAccountP,
    log,
    zoeTools: { localTransfer, withdrawToSeat },
  },
  seat,
  offerArgs,
) => {
  mustMatch(
    offerArgs,
    M.splitRecord(
      {
        destAddr: M.string(),
        receiverAddr: M.string(),
        outDenom: M.string(),
        onFailedDelivery: M.string(),
        slippage: { slippagePercentage: M.string(), windowSeconds: M.number() },
      },
      { nextMemo: M.string() },
    ),
  );
  void log('Begin swapIt');

  const { receiverAddr, destAddr } = offerArgs;
  // NOTE the proposal shape ensures that the `give` is a single asset
  const { give } = seat.getProposal();
  const [[_kw, amt]] = entries(give);
  trace(`sending {${amt.value}} from osmosis to ${receiverAddr}`);
  const denom = await denomForBrand(orch, amt.brand);

  /**
   * @type {any} XXX methods returning vows
   *   https://github.com/Agoric/agoric-sdk/issues/9822
   */
  const sharedLocalAccount = await sharedLocalAccountP;
  /**
   * Helper function to recover if IBC Transfer fails
   *
   * @param {Error} e
   */
  const recoverFailedTransfer = async e => {
    await withdrawToSeat(sharedLocalAccount, seat, give);
    const errorMsg = `IBC Transfer failed ${q(e)}`;
    trace(`ERROR: ${errorMsg}`);
    void log(errorMsg, 'error');
    seat.fail(errorMsg);
    throw makeError(errorMsg);
  };

  const [_a, osmosisChainInfo, connection] =
    await chainHub.getChainsAndConnection('agoric', 'osmosis');

  connection.counterparty || Fail`No IBC connection to Osmosis`;

  trace(`got info for chain: osmosis ${osmosisChainInfo}`);
  trace(osmosisChainInfo);

  const [_b, omniflixChainInfo, omniflixConnection] =
    await chainHub.getChainsAndConnection('osmosis', 'omniflixhub');

  omniflixConnection.counterparty || Fail`No IBC connection to Omniflixhub`;

  trace(`got info for chain: omniflixhub ${omniflixChainInfo}`);
  trace(omniflixChainInfo);

  await localTransfer(seat, sharedLocalAccount, give);
  trace(`completed transfer to localAccount`);

  // chainHub.registerAsset('uosmo', {
  //   chainName: 'agoric',
  //   baseName: 'osmosis',
  //   baseDenom: 'uosmo',
  // });

  try {
    if (denom === 'uflix') {
      await sharedLocalAccount.transfer(
        {
          value: receiverAddr,
          encoding: 'bech32',
          chainId: /** @type {CosmosChainInfo} */ (omniflixChainInfo).chainId,
        },
        { denom, value: amt.value },
      );
      trace(`completed transfer to ${receiverAddr}`);
    } else {
      const memo = buildXCSMemo(offerArgs);
      trace(memo);
      void log(`sending transfer with ${q(memo)}`);

      await sharedLocalAccount.transfer(
        {
          value: destAddr,
          encoding: 'bech32',
          chainId: /** @type {CosmosChainInfo} */ (osmosisChainInfo).chainId,
        },
        { denom, value: amt.value },
        { memo },
      );
      trace(`completed transfer to ${destAddr}`);
    }
  } catch (e) {
    trace(`transfer error`);
    void log(`transfer error ${q(e)}`, 'error');
    return recoverFailedTransfer(e);
  }

  seat.exit();
  trace(`transfer complete, seat exited`);
};
harden(tipFlow);
