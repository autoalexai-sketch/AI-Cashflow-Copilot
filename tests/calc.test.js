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
  eqMoney(t.distributable, 4800);
  eqMoney(t.partnerA.earned, 2400);
  eqMoney(t.partnerA.remaining, 1400); // 2400 - 1000
  eqMoney(t.partnerB.remaining, 1900); // 2400 - 500
  // Invariant: earned shares add up to the distributable profit.
  eqMoney(t.partnerA.earned + t.partnerB.earned, t.distributable);
});

test('one partner withdrew more than earned -> negative remaining (owes the other)', () => {
  const t = computeTotals([
    tx('income', 5000),
    tx('expense', 1000),
    tx('draw', 3000, { partnerSlot: 'owner' })
  ], OPTS_50);
  eqMoney(t.distributable, 3200);      // (4000 - 800)
  eqMoney(t.partnerA.remaining, -1400);// 1600 - 3000
  eqMoney(t.partnerB.remaining, 1600);
});

test('loss month: no tax reserve, nothing to distribute', () => {
  const t = computeTotals([tx('income', 1000), tx('expense', 3000)], OPTS_50);
  eqMoney(t.net, -2000);
  eqMoney(t.reserve, 0);
  eqMoney(t.distributable, 0);
  eqMoney(t.partnerA.earned, 0);
  eqMoney(t.partnerB.earned, 0);
});

test('only verified transactions count; pending and rejected are ignored', () => {
  const t = computeTotals([
    tx('income', 1000),
    tx('income', 5000, { status: 'pending' }),
    tx('income', 7000, { status: 'rejected' }),
    tx('expense', 300, { status: 'pending' })
  ], OPTS_50);
  eqMoney(t.income, 1000);
  eqMoney(t.expenses, 0);
});

test('unequal shares 70/30 and tax rate 0', () => {
  const t = computeTotals([tx('income', 1000)], { taxRate: 0, shareA: 70, shareB: 30 });
  eqMoney(t.partnerA.earned, 700);
  eqMoney(t.partnerB.earned, 300);
});

test('draws are advances: they do not change distributable profit', () => {
  const base = [tx('income', 10000), tx('expense', 2000)];
  const a = computeTotals(base, OPTS_50);
  const b = computeTotals([...base, tx('draw', 5000)], OPTS_50);
  eqMoney(a.distributable, b.distributable);
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
  eqMoney(t.partnerA.earned, 0.15);
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

// ---- Documented current behaviour that needs a product decision ----------
// These tests pin today's behaviour so any change is deliberate.

test('OPEN QUESTION: dashboard and project view treat draws differently', () => {
  // Same data, owner drew 3000, member drew nothing, 50/50, no tax.
  const txs = [tx('income', 10000), tx('draw', 3000, { partnerSlot: 'owner' })];
  const opts = { taxRate: 0, shareA: 50, shareB: 50 };
  const dash = computeTotals(txs, opts);
  const proj = computeProjectSplit(txs, opts, ['verified']);
  // Dashboard: draw = advance. Owner is entitled to 5000 in total.
  eqMoney(dash.partnerA.earned, 5000);
  // Project view: draw = paid labor. Owner is entitled to 3000 + 3500 = 6500.
  eqMoney(proj.laborA + proj.shareA, 6500);
});

test('OPEN QUESTION: project split can go negative (no floor), dashboard floors at 0', () => {
  const txs = [tx('income', 1000), tx('draw', 3000, { partnerSlot: 'owner' })];
  const opts = { taxRate: 0, shareA: 50, shareB: 50 };
  eqMoney(computeProjectSplit(txs, opts, ['verified']).shareB, -1000);
  eqMoney(computeTotals(txs, opts).partnerB.earned, 500);
});
