import { BridgeId, deeplyFulfilledObject } from '@agoric/internal';
import { makeStorageNodeChild } from '@agoric/internal/src/lib-chainStorage.js';
// eslint-disable-next-line no-unused-vars -- used by TS
import { coalesceUpdates } from '@agoric/smart-wallet/src/utils.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import { E } from '@endo/far';
import path from 'path';
import { createPriceFeed } from '../../src/proposals/price-feed-proposal.js';
import { withAmountUtils } from '../supports.js';

/**
 * @param {import('ava').ExecutionContext} t
 * @param {(logger) => Promise<ChainBootstrapSpace>} makeSpace
 */
export const makeDefaultTestContext = async (t, makeSpace) => {
  // To debug, pass t.log instead of null logger
  const log = () => null;
  const { consume, produce } = await makeSpace(log);
  const { agoricNames, zoe } = consume;

  // #region Installs
  const pathname = new URL(import.meta.url).pathname;
  const dirname = path.dirname(pathname);

  const bundleCache = await unsafeMakeBundleCache('bundles/');
  const bundle = await bundleCache.load(
    `${dirname}/../../../smart-wallet/src/walletFactory.js`,
    'walletFactory',
  );
  /** @type {Promise<Installation<import('@agoric/smart-wallet/src/walletFactory.js').start>>} */
  const installation = E(zoe).install(bundle);
  // #endregion

  // copied from makeClientBanks()
  const storageNode = await makeStorageNodeChild(
    consume.chainStorage,
    'wallet',
  );

  const assetPublisher = await E(consume.bankManager).getBankForAddress(
    'anyAddress',
  );
  const bridgeManager = await consume.bridgeManager;
  const walletBridgeManager = await (bridgeManager &&
    E(bridgeManager).register(BridgeId.WALLET));
  const walletFactory = await E(zoe).startInstance(
    installation,
    {},
    {
      agoricNames,
      board: consume.board,
      assetPublisher,
    },
    { storageNode, walletBridgeManager },
  );

  /** @param {string} address */
  const provideWalletAndBalances = async address => {
    // copied from makeClientBanks()
    const bank = await E(consume.bankManager).getBankForAddress(address);

    const [wallet, _isNew] = await E(
      walletFactory.creatorFacet,
    ).provideSmartWallet(address, bank, consume.namesByAddressAdmin);

    /**
     * Read-only facet of bank
     *
     * @param {Brand<'nat'>} brand
     */
    const getBalanceFor = brand =>
      E(E(bank).getPurse(brand)).getCurrentAmount();
    return { getBalanceFor, wallet };
  };

  const simpleProvideWallet = address =>
    provideWalletAndBalances(address).then(({ wallet }) => wallet);

  /**
   *
   * @param {string[]} oracleAddresses
   * @param {string} inBrandName
   * @param {string} outBrandName
   */
  const simpleCreatePriceFeed = async (
    oracleAddresses,
    inBrandName = 'ATOM',
    outBrandName = 'USD',
  ) => {
    // copied from coreProposalBehavior: Publish the installations for behavior dependencies.
    /** @type {ERef<import('@agoric/vats').NameAdmin>} */
    const installAdmin = E(consume.agoricNamesAdmin).lookupAdmin(
      'installation',
    );
    const paBundle = await bundleCache.load(
      '../inter-protocol/src/price/fluxAggregatorContract.js',
      'priceAggregator',
    );
    /** @type {Promise<Installation<import('@agoric/inter-protocol/src/price/fluxAggregatorContract.js').start>>} */
    const paInstallation = E(zoe).install(paBundle);
    await E(installAdmin).update('priceAggregator', paInstallation);

    await createPriceFeed(
      { consume, produce },
      {
        options: {
          priceFeedOptions: {
            AGORIC_INSTANCE_NAME: `${inBrandName}-${outBrandName} price feed`,
            contractTerms: {
              minSubmissionCount: 2,
              minSubmissionValue: 1,
              maxSubmissionCount: 5,
              maxSubmissionValue: 99999,
              restartDelay: 1n,
              timeout: 10,
            },
            oracleAddresses,
            IN_BRAND_NAME: inBrandName,
            OUT_BRAND_NAME: outBrandName,
          },
        },
      },
    );
  };

  const anchor = withAmountUtils(
    // @ts-expect-error xxx type debt
    await deeplyFulfilledObject(consume.testFirstAnchorKit),
  );

  return {
    anchor,
    invitationBrand: await E(E(zoe).getInvitationIssuer()).getBrand(),
    sendToBridge:
      walletBridgeManager && (obj => E(walletBridgeManager).toBridge(obj)),
    consume,
    provideWalletAndBalances,
    simpleProvideWallet,
    simpleCreatePriceFeed,
  };
};

/**
 * @param {import('@agoric/smart-wallet/src/smartWallet.js').CurrentWalletRecord} record
 * @param {Brand<'nat'>} brand
 */
export const currentPurseBalance = (record, brand) => {
  const purses = Array.from(record.purses.values());
  const match = purses.find(b => b.brand === brand);
  if (!match) {
    console.debug('purses', ...purses);
    assert.fail(`${brand} not found in record`);
  }
  return match.balance.value;
};

/**
 * Voting yes (first position) on the one open question using the continuing offer.
 *
 * @param {ERef<CommitteeElectoratePublic>} committeePublic
 * @param {string} voterAcceptanceOID
 * @returns {Promise<import('@agoric/smart-wallet/src/invitations').ContinuingInvitationSpec>}
 */
export const voteForOpenQuestion = async (
  committeePublic,
  voterAcceptanceOID,
) => {
  const questions = await E(committeePublic).getOpenQuestions();
  assert.equal(questions.length, 1);
  const question = E(committeePublic).getQuestion(questions[0]);
  const { positions, questionHandle } = await E(question).getDetails();
  const yesPosition = harden([positions[0]]);

  /** @type {import('@agoric/smart-wallet/src/invitations').ContinuingInvitationSpec} */
  const getVoteSpec = {
    source: 'continuing',
    previousOffer: voterAcceptanceOID,
    invitationMakerName: 'makeVoteInvitation',
    invitationArgs: harden([yesPosition, questionHandle]),
  };

  return getVoteSpec;
};
