import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../../src/shared/index.js';

describe('getLogger call forms', () => {
    it('accepts the message first, the bunyan way, and keeps the defaults in the entry', () => {
        const calls: unknown[][] = [];
        const logger = shared.getLogger({ logger: { info: (...args: unknown[]) => calls.push(args) } }, { component: 'test' });
        logger.info('hello %s', 'world');
        logger.info({ tnx: 'x' }, 'with data');
        logger.info();
        assert.deepStrictEqual(calls, [
            [{ component: 'test' }, 'hello %s', 'world'],
            [{ component: 'test', tnx: 'x' }, 'with data'],
            [{ component: 'test' }, undefined]
        ]);
    });
});
