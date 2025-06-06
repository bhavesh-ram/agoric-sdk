// @ts-check
import { Fail } from '@endo/errors';
import { E } from '@endo/far';

/**
 * @import {InvitationDetails, PaymentPKeywordRecord, Proposal, UserSeat} from '@agoric/zoe';
 */

/**
 * @param {ERef<UserSeat>} seat
 * @param {string} expectedOfferResult
 * @returns {Promise<void>}
 */
export const assertOfferResult = async (seat, expectedOfferResult) => {
  const actualOfferResult = await E(seat).getOfferResult();
  actualOfferResult === expectedOfferResult ||
    Fail`offerResult (${actualOfferResult}) did not equal expected: ${expectedOfferResult}`;
};
