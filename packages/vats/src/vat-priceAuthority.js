/**
 * @import {Baggage} from '@agoric/vat-data';
 */
import { Far } from '@endo/marshal';
import { providePriceAuthorityRegistry } from './priceAuthorityRegistry.js';

/**
 * Vat holding the canonical PriceAuthorityRegistry for looking up prices on any
 * registered tuple of brands.
 *
 * @param {VatPowers} _vatPowers
 * @param {unknown} _vatParams
 * @param {Baggage} baggage
 */
export function buildRootObject(_vatPowers, _vatParams, baggage) {
  const registry = providePriceAuthorityRegistry(baggage);
  return Far('root', { getRegistry: () => registry });
}
