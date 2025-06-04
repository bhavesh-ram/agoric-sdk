import {
    deeplyFulfilledObject,
    makeTracer,
    NonNullish,
  } from '@agoric/internal';
  import { E } from '@endo/far';
  
  /// <reference types="@agoric/vats/src/core/types-ambient"/>
  
  /**
   * @import {Installation} from '@agoric/zoe/src/zoeService/utils.js';
   * @import {CosmosChainInfo, Denom, DenomDetail} from '@agoric/orchestration';
   * @import {start as StartFn} from '@agoric/orchestration/src/examples/omniflix-tip.contract.js';
   */
  
  const trace = makeTracer('StartOmniflixTip', true);
  
  /**
   * @param {BootstrapPowers & {
   *   installation: {
   *     consume: {
   *       omniflixTip: Installation<StartFn>;
   *     };
   *   };
   *   instance: {
   *     produce: {
   *       omniflixTip: Producer<Instance>;
   *     };
   *   };
   *   issuer: {
   *     consume: {
   *       BLD: Issuer<'nat'>;
   *       IST: Issuer<'nat'>;
   *       ATOM: Issuer<'nat'>;
   *     };
   *   };
   * }} powers
   * @param {{
   *   options: {
   *     chainInfo: Record<string, CosmosChainInfo>;
   *     assetInfo: [Denom, DenomDetail & { brandKey?: string }][];
   *   };
   * }} config
   */
  export const startOmniflixTip = async (
    {
      consume: {
        agoricNames,
        board,
        chainStorage,
        chainTimerService,
        cosmosInterchainService,
        localchain,
        startUpgradable,
      },
      installation: {
        consume: { omniflixTip },
      },
      instance: {
        produce: { omniflixTip: produceInstance },
      },
      issuer: {
        consume: { BLD, IST, ATOM },
      },
    },
    { options: { chainInfo, assetInfo } },
  ) => {
    trace(startOmniflixTip.name);
  
    const marshaller = await E(board).getReadonlyMarshaller();
  
    const privateArgs = await deeplyFulfilledObject(
      harden({
        agoricNames,
        localchain,
        marshaller,
        orchestrationService: cosmosInterchainService,
        storageNode: E(NonNullish(await chainStorage)).makeChildNode(
          'omniflix-tip',
        ),
        timerService: chainTimerService,
        chainInfo,
        assetInfo,
      }),
    );
  
    const issuerKeywordRecord = harden({
      BLD: await BLD,
      IST: await IST,
      ATOM: await ATOM,
    });
    trace('issuerKeywordRecord', issuerKeywordRecord);
  
    const { instance } = await E(startUpgradable)({
      label: 'omniflix-tip',
      installation: omniflixTip,
      issuerKeywordRecord,
      privateArgs,
    });
    produceInstance.resolve(instance);
    trace('done');
  };
  harden(startOmniflixTip);
  
  export const getManifest = ({ restoreRef }, { installationRef, options }) => {
    return {
      manifest: {
        [startOmniflixTip.name]: {
          consume: {
            agoricNames: true,
            board: true,
            chainStorage: true,
            chainTimerService: true,
            cosmosInterchainService: true,
            localchain: true,
  
            startUpgradable: true,
          },
          installation: {
            consume: { omniflixTip: true },
          },
          instance: {
            produce: { omniflixTip: true },
          },
          issuer: {
            consume: { BLD: true, IST: true, ATOM: true },
          },
        },
      },
      installations: {
        omniflixTip: restoreRef(installationRef),
      },
      options,
    };
  };
  