// Tax reserve rate "from a date" (tax_periods, 2026-11-22).
// Changing the rate must not re-count the reserve of earlier periods.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals, computeProjectSplit, computeSplitByPeriods } = require('../calc.js');

const cents = (x) => Math.round(x * 100);
const eqMoney = (actual, expected, msg) => assert.equal(cents(actual), cents(expected), msg);
const tx = (type, amount, date, extra = {}) => ({
  type, amount, date, status: 'verified', account: 'Bank', partnerSlot: 'owner', ...extra
});
const OPTS = { taxRate: 10, shareA: 50, shareB: 50, drawMode: 'labor' };
const october = [tx('income', 1000, '2026-10-10')];
const november = [tx('income', 2000, '2026-11-05')];

test('no tax periods: identical to the old split', () => {
  const txs = [...october, ...november];
  assert.deepEqual(computeSplitByPeriods(txs, OPTS, ['verified'], [], []), computeProjectSplit(txs, OPTS, ['verified']));
});

test('raising the rate from November does not touch October', () => {
  const tax = [{ from: '1900-01-01', taxRate: 10 }, { from: '2026-11-01', taxRate: 19 }];
  const r = computeSplitByPeriods([...october, ...november], OPTS, ['verified'], null, tax);
  eqMoney(r.reserve, 100 + 380);           // 10 % of 1000 + 19 % of 2000
  eqMoney(r.shareA + r.shareB, 900 + 1620);
});

test('share and tax changes on different dates cut the history into three periods', () => {
  const shares = [{ from: '1900-01-01', shareA: 50 }, { from: '2026-12-01', shareA: 60 }];
  const tax = [{ from: '1900-01-01', taxRate: 10 }, { from: '2026-11-01', taxRate: 20 }];
  const december = [tx('income', 1000, '2026-12-03')];
  const r = computeSplitByPeriods([...october, ...november, ...december], OPTS, ['verified'], shares, tax);
  // Oct: 1000, tax 10 % -> 900, 50/50 -> 450/450
  // Nov: 2000, tax 20 % -> 1600, 50/50 -> 800/800
  // Dec: 1000, tax 20 % -> 800, 60/40 -> 480/320
  eqMoney(r.reserve, 100 + 400 + 200);
  eqMoney(r.shareA, 450 + 800 + 480);
  eqMoney(r.shareB, 450 + 800 + 320);
});

test('only tax periods: shares come from opts', () => {
  const tax = [{ from: '1900-01-01', taxRate: 0 }, { from: '2026-11-01', taxRate: 50 }];
  const r = computeSplitByPeriods([...october, ...november], { ...OPTS, shareA: 70, shareB: 30 }, ['verified'], null, tax);
  eqMoney(r.shareA, 700 + 700);
  eqMoney(r.shareB, 300 + 300);
});

test('solo shares (100/0 in opts) stay 100 % with tax periods', () => {
  const tax = [{ from: '1900-01-01', taxRate: 10 }, { from: '2026-11-01', taxRate: 20 }];
  const r = computeSplitByPeriods([...october, ...november], { ...OPTS, shareA: 100, shareB: 0 }, ['verified'], null, tax);
  eqMoney(r.shareB, 0);
});

test('computeTotals uses opts.taxPeriods', () => {
  const tax = [{ from: '1900-01-01', taxRate: 10 }, { from: '2026-11-01', taxRate: 19 }];
  const t = computeTotals([...october, ...november], { ...OPTS, taxPeriods: tax });
  eqMoney(t.reserve, 480);
});
