// Partner shares "from a date" (share_periods, 2026-11-22).
// A change of shares must not re-split money from before its start date.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals, computeProjectSplit, computeSplitByPeriods } = require('../calc.js');

const cents = (x) => Math.round(x * 100);
const eqMoney = (actual, expected, msg) => assert.equal(cents(actual), cents(expected), msg);
const tx = (type, amount, date, extra = {}) => ({
  type, amount, date, status: 'verified', account: 'Bank', partnerSlot: 'owner', ...extra
});
const OPTS = { taxRate: 20, shareA: 50, shareB: 50, drawMode: 'labor' };

const october = [tx('income', 1000, '2026-10-10'), tx('expense', 200, '2026-10-12')];
const november = [tx('income', 2000, '2026-11-05')];

test('no periods: identical to the old whole-history split', () => {
  const txs = [...october, ...november];
  assert.deepEqual(computeSplitByPeriods(txs, OPTS, ['verified'], []), computeProjectSplit(txs, OPTS, ['verified']));
  assert.deepEqual(computeSplitByPeriods(txs, OPTS, ['verified'], undefined), computeProjectSplit(txs, OPTS, ['verified']));
});

test('one period equals using its shares for everything', () => {
  const txs = [...october, ...november];
  const periods = [{ from: '1900-01-01', shareA: 70 }];
  assert.deepEqual(
    computeSplitByPeriods(txs, OPTS, ['verified'], periods),
    computeProjectSplit(txs, { ...OPTS, shareA: 70, shareB: 30 }, ['verified'])
  );
});

test('changing shares from November does not touch October', () => {
  const periods = [{ from: '1900-01-01', shareA: 50 }, { from: '2026-11-01', shareA: 60 }];
  const before = computeSplitByPeriods(october, OPTS, ['verified'], periods);
  const oldWay = computeProjectSplit(october, OPTS, ['verified']);
  eqMoney(before.shareA, oldWay.shareA, 'October share A stays 50 %');
  eqMoney(before.shareB, oldWay.shareB, 'October share B stays 50 %');

  // October: net 800, reserve 160, remainder 640 -> 320 / 320
  // November: net 2000, reserve 400, remainder 1600 -> 960 / 640
  const all = computeSplitByPeriods([...october, ...november], OPTS, ['verified'], periods);
  eqMoney(all.shareA, 320 + 960);
  eqMoney(all.shareB, 320 + 640);
  eqMoney(all.reserve, 160 + 400);
  eqMoney(all.remainder, 640 + 1600);
});

test('a period sums to the cent (A + B == remainder)', () => {
  const txs = [tx('income', 100.01, '2026-10-01'), tx('income', 33.33, '2026-12-01')];
  const r = computeSplitByPeriods(txs, { taxRate: 0, shareA: 50, shareB: 50 }, ['verified'],
    [{ from: '1900-01-01', shareA: 33.3 }, { from: '2026-11-01', shareA: 66.7 }]);
  assert.equal(cents(r.shareA) + cents(r.shareB), cents(r.remainder));
});

test('transaction dated exactly on the start date uses the new shares', () => {
  const r = computeSplitByPeriods([tx('income', 100, '2026-11-01')], { taxRate: 0, shareA: 50, shareB: 50 }, ['verified'],
    [{ from: '1900-01-01', shareA: 50 }, { from: '2026-11-01', shareA: 80 }]);
  eqMoney(r.shareA, 80);
});

test('draws stay with their period and partner', () => {
  const periods = [{ from: '1900-01-01', shareA: 50 }, { from: '2026-11-01', shareA: 60 }];
  const txs = [...october, tx('draw', 100, '2026-10-20', { partnerSlot: 'member' }), ...november];
  const r = computeSplitByPeriods(txs, OPTS, ['verified'], periods);
  eqMoney(r.laborB, 100);
  // October remainder 640 - 100 = 540 -> 270 / 270; November 960 / 640
  eqMoney(r.totalB, 270 + 100 + 640);
  eqMoney(r.totalA, 270 + 960);
});

test('unsorted periods are handled', () => {
  const sorted = [{ from: '1900-01-01', shareA: 50 }, { from: '2026-11-01', shareA: 60 }];
  const txs = [...october, ...november];
  assert.deepEqual(
    computeSplitByPeriods(txs, OPTS, ['verified'], [sorted[1], sorted[0]]),
    computeSplitByPeriods(txs, OPTS, ['verified'], sorted)
  );
});

test('computeTotals uses opts.sharePeriods', () => {
  const periods = [{ from: '1900-01-01', shareA: 50 }, { from: '2026-11-01', shareA: 60 }];
  const t = computeTotals([...october, ...november], { ...OPTS, sharePeriods: periods });
  eqMoney(t.partnerA.share, 320 + 960);
  eqMoney(t.partnerB.share, 320 + 640);
  eqMoney(t.reserve, 560);
});
