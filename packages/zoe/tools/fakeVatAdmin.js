// no jessie-check because this code runs only in Node for testing
/* eslint-env node */

import { Fail } from '@endo/errors';
import { E } from '@endo/eventual-send';
import { makePromiseKit } from '@endo/promise-kit';
import { Far } from '@endo/marshal';
import { makeScalarMapStore } from '@agoric/store';
import { makeScalarBigMapStore } from '@agoric/vat-data';

import { evalContractBundle } from '../src/contractFacet/evalContractCode.js';
import { handlePKitWarning } from '../src/handleWarning.js';
import { makeHandle } from '../src/makeHandle.js';
import zcfBundle from '@agoric/zoe/bundles/bundle-contractFacet.js';

/**
 * @import {MapStore} from '@agoric/swingset-liveslots';
 * @import {BundleID, EndoZipBase64Bundle, TestBundle} from '@agoric/swingset-vat';
 */

// this simulates a bundlecap, which is normally a swingset "device node"
/** @typedef { import('@agoric/swingset-vat').BundleCap } BundleCap */
/** @type {() => BundleCap} */
const fakeBundleCap = () => makeHandle('FakeBundleCap');
const bogusBundleCap = () => makeHandle('BogusBundleCap');
export const zcfBundleCap = fakeBundleCap();

/**
 * @param {(...args) => unknown} [testContextSetter]
 * @param {(x: unknown) => unknown} [makeRemote]
 */
function makeFakeVatAdmin(testContextSetter = undefined, makeRemote = x => x) {
  // FakeVatPowers isn't intended to support testing of vat termination, it is
  // provided to allow unit testing of contracts that call zcf.shutdown()
  let exitMessage;
  let hasExited = false;
  let exitWithFailure;
  /** @type {MapStore<BundleID, BundleCap>} */
  const idToBundleCap = makeScalarMapStore('idToBundleCap');
  /** @type {Map<BundleCap, EndoZipBase64Bundle | {moduleFormat: 'test'}>} */
  const bundleCapToBundle = new Map();
  /** @type {MapStore<string, BundleID>} */
  const nameToBundleID = makeScalarMapStore('nameToBundleID');
  const fakeVatPowers = {
    exitVatWithFailure: reason => {
      exitMessage = reason;
      hasExited = true;
      exitWithFailure = true;
    },
    D: bundleCap => ({
      getBundle: () => bundleCapToBundle.get(bundleCap),
    }),
    testJigSetter: testContextSetter,
  };

  // This is explicitly intended to be mutable so that
  // test-only state can be provided from contracts
  // to their tests.
  const admin = Far('vatAdmin', {
    getBundleCap: bundleID => {
      if (!idToBundleCap.has(bundleID)) {
        idToBundleCap.init(bundleID, bogusBundleCap());
      }
      return Promise.resolve(idToBundleCap.get(bundleID));
    },
    waitForBundleCap: bundleID => {
      if (!idToBundleCap.has(bundleID)) {
        idToBundleCap.init(bundleID, bogusBundleCap());
      }
      return Promise.resolve(idToBundleCap.get(bundleID));
    },
    getNamedBundleCap: name => {
      if (name === 'zcf') {
        return Promise.resolve(zcfBundleCap);
      }
      const id = nameToBundleID.get(name);
      return Promise.resolve(idToBundleCap.get(id));
    },
    getBundleIDByName: name => {
      return Promise.resolve().then(() => nameToBundleID.get(name));
    },
    createVat: (bundleCap, { vatParameters = {} } = {}) => {
      bundleCap === zcfBundleCap || Fail`fakeVatAdmin only knows ZCF`;
      const exitKit = makePromiseKit();
      handlePKitWarning(exitKit);
      const exitVat = completion => {
        exitMessage = completion;
        hasExited = true;
        exitWithFailure = false;
        exitKit.resolve(completion);
      };
      const vpow = harden({
        ...fakeVatPowers,
        exitVat,
      });
      const vatBaggage = makeScalarBigMapStore('fake vat baggage', {
        durable: true,
      });

      // XXX Notice that this call isn't wrapping vatParams.  We (BW, CH) tried
      // doing this, but backed out when it got complex.
      //
      // const ns = await evalContractBundle(zcfBundle);
      // const ns2 = makeRemote(
      //   Far('wrappedRoot', {
      //     buildRootObject: vp => ns.buildRootObject(vpow, vp, vatBaggage),
      //   }),
      // );
      const rootP = makeRemote(
        E(evalContractBundle(zcfBundle)).buildRootObject(
          vpow,
          vatParameters,
          vatBaggage,
        ),
      );
      return E.when(rootP, root =>
        harden({
          root,
          adminNode: Far('adminNode', {
            done: () => {
              return exitKit.promise;
            },
            terminateWithFailure: () => {},
            upgrade: (_bundleCap, _options) => Fail`upgrade not faked`,
          }),
        }),
      );
    },
  });
  const criticalVatKey = harden({});
  const vatPowers = harden({
    D: bcap => {
      const bundle = bundleCapToBundle.get(bcap);
      bundle || Fail`fake D only does fake bundlecaps`;
      return harden({ getBundle: () => bundle });
    },
  });
  const vatAdminState = {
    getExitMessage: () => exitMessage,
    getHasExited: () => hasExited,
    getExitWithFailure: () => exitWithFailure,
    /**
     * @param {string} id
     * @param {EndoZipBase64Bundle | TestBundle} bundle
     */
    installBundle: (id, bundle) => {
      if (idToBundleCap.has(id)) {
        const extant = bundleCapToBundle.get(idToBundleCap.get(id));
        assert(extant);
        assert.equal(bundle.moduleFormat, extant.moduleFormat);
        if (extant.moduleFormat === 'endoZipBase64') {
          // Narrow bundle.moduleFormat now that extant.moduleFormat is narrowed
          assert.equal(bundle.moduleFormat, extant.moduleFormat);
          assert.equal(bundle.endoZipBase64, extant.endoZipBase64);
        }
        return idToBundleCap.get(id);
      }
      const bundleCap = fakeBundleCap();
      idToBundleCap.init(id, bundleCap);
      bundleCapToBundle.set(bundleCap, bundle);
      return bundleCap;
    },
    installNamedBundle: (name, id, bundle) => {
      nameToBundleID.init(name, id);
      return vatAdminState.installBundle(id, bundle);
    },
    getCriticalVatKey: () => criticalVatKey,
    getVatPowers: () => vatPowers,
  };
  return { admin, vatAdminState };
}

// Tests which use this global/shared fakeVatAdmin should really import
// makeFakeVatAdmin() instead, and build their own private instance. This
// will be forced when #4565 requires them to use
// vatAdminState.installBundle().

const fakeVatAdmin = makeFakeVatAdmin().admin;

export default fakeVatAdmin;
export { makeFakeVatAdmin };
