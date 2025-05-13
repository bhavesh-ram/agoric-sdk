import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import { setUpZoeForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { E } from '@endo/far';
import { eventLoopIteration } from '@agoric/internal/src/testing-utils.js';
import { encodeAddressHook } from '@agoric/cosmic-proto/address-hooks.js';
import { NonNullish } from '@agoric/internal';
import * as contractExports from '../../src/examples/omniflix-tip.contract.js';
import { commonSetup } from '../supports.js';
import { buildVTransferEvent } from '../../tools/ibc-mocks.js';

const contractName = 'omniflix-tip';
type StartFn = typeof contractExports.start;

const config = {
  xcsInformation: {
    // A message that we know to be working
    rawMsgNoNextMemo:
      '{"wasm":{"contract":"osmo17p9rzwnnfxcjp32un9ug7yhhzgtkhvl9jfksztgw5uh69wac2pgs5yczr8","msg":{"osmosis_swap":{"output_denom":"ibc/CEE970BB3D26F4B907097B6B660489F13F3B0DA765B83CC7D9A0BC0CE220FA6F","slippage":{"twap":{"window_seconds":10,"slippage_percentage":"20"}},"receiver":"omniflix1xdfw3q8phtqarwv2eflq4pqpek4u9n6ejnsjge","on_failed_delivery":"do_nothing"}}}}',
  },
};

const bootstrapOrchestration = async t => {
  t.log('bootstrap, orchestration core-eval');
  const {
    bootstrap,
    commonPrivateArgs,
    brands: { flix, bld, ist, osmo },
    utils: { inspectLocalBridge, pourPayment, transmitTransferAck },
    mocks: { transferBridge },
  } = await commonSetup(t);
  const vt = bootstrap.vowTools;

  const { zoe, bundleAndInstall } = await setUpZoeForTest();

  t.log('contract coreEval', contractName);

  const installation: Installation<StartFn> =
    await bundleAndInstall(contractExports);

  const storageNode = await E(bootstrap.storage.rootNode).makeChildNode(
    contractName,
  );

  const tipKit = await E(zoe).startInstance(
    installation,
    { FLIX: flix.issuer, BLD: bld.issuer, IST: ist.issuer, OSMO: osmo.issuer, },
    {},
    { ...commonPrivateArgs, storageNode },
  );

  return {
    bootstrap,
    commonPrivateArgs,
    flix,
    bld,
    osmo,
    inspectLocalBridge,
    pourPayment,
    transmitTransferAck,
    vt,
    zoe,
    installation,
    storageNode,
    tipKit,
    transferBridge,
  };
};

const buildOfferArgs = rawMsg => {
  const {
    wasm: {
      contract,
      msg: {
        osmosis_swap: {
          receiver,
          output_denom: outDenom,
          slippage: {
            twap: {
              slippage_percentage: slippagePercentage,
              window_seconds: windowSeconds,
            },
          },

          on_failed_delivery: onFailedDelivery,
          next_memo: nextMemo,
        },
      },
    },
  } = JSON.parse(rawMsg);

  return {
    destAddr: contract,
    receiverAddr: receiver,
    outDenom,
    slippage: { slippagePercentage, windowSeconds },
    onFailedDelivery,
    nextMemo,
  };
};

test('tip Flix for Osmo, receiver on Omniflixhub', async t => {
  const {
    vt,
    tipKit,
    zoe,
    pourPayment,
    flix,
    bld,
    osmo,
    transmitTransferAck,
    inspectLocalBridge,
  } = await bootstrapOrchestration(t);

  const publicFacet = await E(zoe).getPublicFacet(tipKit.instance);
  const inv = E(publicFacet).makeTipInvitation();
  const amt = await E(zoe).getInvitationDetails(inv);
  t.is(amt.description, 'tip');

  // const anAmt = flix.units(3.5);
  const anAmt = bld.units(3.5);
  // const anAmt = osmo.units(3.5);
  const Send = await pourPayment(anAmt);
  const offerArgs = buildOfferArgs(config.xcsInformation.rawMsgNoNextMemo);
  t.log('offerArgs', offerArgs);
  const userSeat = await E(zoe).offer(
    inv,
    { give: { Send: anAmt } },
    { Send },
    offerArgs,
  );
  await transmitTransferAck();
  await vt.when(E(userSeat).getOfferResult());

  const history = inspectLocalBridge();
  t.log(history);
  t.like(history, [
    { type: 'VLOCALCHAIN_ALLOCATE_ADDRESS' },
    { type: 'VLOCALCHAIN_EXECUTE_TX' },
  ]);

  if (anAmt.brand === flix.brand) {
    const tx = history.find(x => x.type === 'VLOCALCHAIN_EXECUTE_TX')?.messages?.[0];
    t.log(tx);
    t.is(tx['@type'], '/ibc.applications.transfer.v1.MsgTransfer');
    t.is(tx.receiver, offerArgs.destAddr);
  } else {
    t.like(
      history.find(x => x.type === 'VLOCALCHAIN_EXECUTE_TX')?.messages?.[0],
      {
        '@type': '/ibc.applications.transfer.v1.MsgTransfer',
        receiver: offerArgs.destAddr, // XCS contract has to be the one receiving the IBC message
        sender: 'agoric1fakeLCAAddress',
        memo: config.xcsInformation.rawMsgNoNextMemo,
      },
      'crosschain tip sent',
    );
  }
});

/**
 * UNTIL https://github.com/Agoric/BytePitchPartnerEng/issues/51, we are skipping this
 * until the ticket above is done
 */
// test.skip('trigger osmosis swap from an address hook', async t => {
//   const {
//     bootstrap: { storage },
//     transferBridge,
//     inspectLocalBridge,
//     commonPrivateArgs,
//   } = await bootstrapOrchestration(t);
//   await eventLoopIteration();

//   const { sharedLocalAccount } = commonPrivateArgs.marshaller.fromCapData(
//     JSON.parse(
//       NonNullish(storage.data.get('mockChainStorageRoot.swap-anything')),
//     ),
//   );

//   t.deepEqual(sharedLocalAccount.value, 'agoric1fakeLCAAddress');

//   const memoArgs = buildOfferArgs(config.xcsInformation.rawMsgNoNextMemo);
//   t.log(memoArgs);

//   await E(transferBridge).fromBridge(
//     buildVTransferEvent({
//       event: 'writeAcknowledgement',
//       denom: 'ubld',
//       receiver: encodeAddressHook(
//         'agoric1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp7zqht',
//         {
//           destAddr: memoArgs.destAddr,
//           receiverAddr: memoArgs.receiverAddr,
//           outDenom: memoArgs.outDenom,
//         },
//       ),
//     }),
//   );
//   await eventLoopIteration();

//   const history = inspectLocalBridge();
//   t.log(history);

//   t.like(
//     history.find(x => x.type === 'VLOCALCHAIN_EXECUTE_TX')?.messages?.[0],
//     {
//       '@type': '/ibc.applications.transfer.v1.MsgTransfer',
//       receiver: memoArgs.destAddr, // XCS contract has to be the one receiving the IBC message
//       sender: 'agoric1fakeLCAAddress',
//       memo: config.xcsInformation.rawMsgNoNextMemo,
//     },
//     'crosschain swap sent',
//   );
// });

// test.todo('should throw when Osmosis not connected');
