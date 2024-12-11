import { RuleTester } from 'eslint';
import rule from '../../src/rules/group-jsdoc-imports.js';

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('group-jsdoc-imports', rule, {
  valid: [
    {
      code: `
/** @type {FollowerOptions} */
const options = {};
      `,
      options: [{ paths: ['@agoric/'] }],
    },
    {
      code: `
/**
 * @import {FollowerOptions} from '@agoric/casting';
 */
/** @type {FollowerOptions} */
const options = {};
      `,
      options: [{ paths: ['@agoric/'] }],
    },
  ],
  invalid: [
    {
      code: `/** @type {import('@agoric/casting').FollowerOptions} */
const options = {};`,
      options: [{ paths: ['@agoric/'] }],
      output: `/**
 * @import {FollowerOptions} from '@agoric/casting';
 */
/** @type {FollowerOptions} */
const options = {};`,
      errors: [
        { message: 'Move inline type import to top-level JSDoc import block' },
      ],
    },
    {
      code: `/**
 * @import {Something} from '@agoric/other';
 */
/** @type {import('@agoric/casting').FollowerOptions} */
const options = {};`,
      options: [{ paths: ['@agoric/'] }],
      output: `/**
 * @import {Something} from '@agoric/other';
 * @import {FollowerOptions} from '@agoric/casting';
 */
/** @type {FollowerOptions} */
const options = {};`,
      errors: [
        { message: 'Move inline type import to top-level JSDoc import block' },
      ],
    },
  ],
});
