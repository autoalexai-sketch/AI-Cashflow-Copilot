// Unit tests for calc.js — run from the repo root with:  node --test
// No dependencies: uses Node's built-in test runner (Node 18+).
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTotals, computeProjectSplit, accountBalance, signedAmount } = require('../calc.js');

// Money is stored as floats today, so compare to the cent.
const cents = (x) => Math.round(x * 100);
const eqMoney = (actual, expected, msg) => assert.equal(cents(actual), cents(expected), msg);

const tx = (type, amount, extra = {}) => ({
  type, amount, status: 'verified', account: 'Bank', partnerSlot: 'owner', ...extra
});
const OPTS_50 = { taxRate: 20, shareA: 50, shareB: 50 };

test('signedAmount: income +, expense/draw -, transfer 0', () => {
  assert.equal(signedAmount(tx('income', 100)), 100);
  assert.equal(signedAmount(tx('expense', 40)), -40);
  assert.equal(signedAmount(tx('draw', 10)), -10);
  assert.equal(signedAmount(tx('transfer', 99)), 0);
});

test('month where both partners are in plus', () => {
  const t = computeTotals([
    tx('income', 10000),
    tx('expense', 4000),
    tx('draw', 1000, { partnerSlot: 'owner' }),
    tx('draw', 500, { partnerSlot: 'member' })
  ], OPTS_50);
  eqMoney(t.net, 6000);
  eqMoney(t.reserve, 1200);            // 20 % of 6000
  eqMoney(t.distributable, 3300);      // 6000 - 1200 - 1000 - 500
  eqMoney(t.partnerA.labor, 1000);
  eqMoney(t.partnerA.share, 1650);
  eqMoney(t.partnerA.total, 2650);
  eqMoney(t.partnerB.total, 2150);     // 500 + 1650
  // Invariant: work payments + shares + reserve == net profit
  eqMoney(t.partnerA.total + t.partnerB.total + t.reserve, t.net);
});

test('one partner was paid a lot for work -> still gets their share of the rest', () => {
  const t = computeTotals([
    tx('income', 5000),
    tx('expense', 1000),
    tx('draw', 3000, { partnerSlot: 'owner' })
  ], OPTS_50);
  eqMoney(t.distributable, 200);       // 4000 - 800 - 3000
  eqMoney(t.partnerA.total, 3100);
  eqMoney(t.partnerB.total, 100);
});

test('loss month: no tax reserve, the loss is shared by share %', () => {
  const t = computeTotals([tx('income', 1000), tx('expense', 3000)], OPTS_50);
  eqMoney(t.net, -2000);
  eqMoney(t.reserve, 0);
  eqMoney(t.distributable, -2000);
  eqMoney(t.partnerA.share, -1000);
  eqMoney(t.partnerB.share, -1000);
});

test('only verified transactions count; pending and rejected are ignored', () => {
  const t = computeTotals([
    tx('income', 1000),
    tx('income', 5000, { status: 'pending' }),
    tx('income', 7000, { status: 'rejected' }),
    tx('expense', 300, { status: 'pending' }),
    tx('draw', 400, { status: 'pending' })
  ], OPTS_50);
  eqMoney(t.income, 1000);
  eqMoney(t.expenses, 0);
  eqMoney(t.partnerA.labor, 0);
});

test('unequal shares 70/30 and tax rate 0', () => {
  const t = computeTotals([tx('income', 1000)], { taxRate: 0, shareA: 70, shareB: 30 });
  eqMoney(t.partnerA.share, 700);
  eqMoney(t.partnerB.share, 300);
});

test('work payments reduce what is left to split', () => {
  const base = [tx('income', 10000), tx('expense', 2000)];
  const a = computeTotals(base, OPTS_50);
  const b = computeTotals([...base, tx('draw', 5000)], OPTS_50);
  eqMoney(a.distributable - b.distributable, 5000);
});

test('account balances: Bank and Cash tracked separately, verified only', () => {
  const txs = [
    tx('income', 1000, { account: 'Bank' }),
    tx('expense', 200, { account: 'Cash' }),
    tx('draw', 100, { account: 'Bank' }),
    tx('income', 999, { account: 'Cash', status: 'pending' })
  ];
  eqMoney(accountBalance(txs, 'Bank'), 900);
  eqMoney(accountBalance(txs, 'Cash'), -200);
});

test('float sums stay correct to the cent (0.1 + 0.2 case)', () => {
  const t = computeTotals([tx('income', 0.1), tx('income', 0.2)], { taxRate: 0, shareA: 50, shareB: 50 });
  eqMoney(t.income, 0.3);
  eqMoney(t.partnerA.share, 0.15);
});

test('project split: labor draws first, then shares of the remainder', () => {
  const s = computeProjectSplit([
    tx('income', 10000),
    tx('expense', 2000),
    tx('draw', 1000, { partnerSlot: 'owner' }),
    tx('draw', 600, { partnerSlot: 'member' })
  ], OPTS_50, ['verified']);
  eqMoney(s.reserve, 1600);            // 20 % of 8000
  eqMoney(s.shareA, 2400);             // (8000 - 1600 - 1600) / 2
  eqMoney(s.laborA + s.shareA, 3400);
  eqMoney(s.laborB + s.shareB, 3000);
  // Invariant: labor + shares + reserve == net
  eqMoney(s.laborA + s.laborB + s.shareA + s.shareB + s.reserve, 8000);
});

test('project split forecast includes pending when asked', () => {
  const txs = [tx('income', 1000), tx('income', 1000, { status: 'pending' })];
  const v = computeProjectSplit(txs, { taxRate: 0, shareA: 50, shareB: 50 }, ['verified']);
  const f = computeProjectSplit(txs, { taxRate: 0, shareA: 50, shareB: 50 }, ['verified', 'pending']);
  eqMoney(v.shareA, 500);
  eqMoney(f.shareA, 1000);
});

// ---- Dashboard and project view must agree (decision 2026-09-26) ---------
// Model: draws = payment for work; the rest is split by share, no floor.

test('dashboard totals == project split over the same transactions', () => {
  const txs = [
    tx('income', 10000), tx('expense', 1500),
    tx('draw', 3000, { partnerSlot: 'owner' }), tx('draw', 700, { partnerSlot: 'member' }),
    tx('income', 999, { status: 'pending' })
  ];
  const opts = { taxRate: 12, shareA: 60, shareB: 40 };
  const dash = computeTotals(txs, opts);
  const proj = computeProjectSplit(txs, opts, ['verified']);
  eqMoney(dash.partnerA.total, proj.laborA + proj.shareA);
  eqMoney(dash.partnerB.total, proj.laborB + proj.shareB);
  eqMoney(dash.reserve, proj.reserve);
});

test('BruClean case (2026-09-26): owner paid 13 100 for work, 10 % tax, 50/50', () => {
  const t = computeTotals([
    tx('income', 27918.54), tx('expense', 3439.23), tx('draw', 13100, { partnerSlot: 'owner' })
  ], { taxRate: 10, shareA: 50, shareB: 50 });
  eqMoney(t.partnerA.total, 17565.69);
  eqMoney(t.partnerA.share, 4465.69);
  eqMoney(t.partnerB.total, 4465.69);
});
