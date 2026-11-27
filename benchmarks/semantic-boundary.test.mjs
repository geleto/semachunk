import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustBoundaries } from './semantic-boundary.mjs';

test('moving a weak sibling boundary preserves both passages, their citations and the token limit', async () => {
    const raw = ['Apples grow.','Pears grow.','Ships sail.','Boats float.','Ships return.'].join('\n\n');
    const count = s => s.trim().split(/\s+/u).length;
    const embed = xs => xs.map(s => /grow/u.test(s) ? [1,0] : [0,1]);
    for (const format of ['text','markdown']) {
        const {rows,moved} = await adjustBoundaries({raw,format},6,count,'weakest',embed);
        assert.equal(moved,1);
        assert.deepEqual(rows.map(r=>r.text),['Apples grow.\n\nPears grow.','Ships sail.\n\nBoats float.\n\nShips return.']);
        for (const r of rows) {
            const [{start,end}]=r.sourceRanges;
            assert.equal(raw.slice(start,end),r.text);
            assert(count(r.text)<=6);
        }
        const balanced = await adjustBoundaries({raw,format},6,count,'balance',assert.fail);
        assert.equal(balanced.moved,0);
        assert.equal(balanced.rows.length,rows.length);
    }
});
