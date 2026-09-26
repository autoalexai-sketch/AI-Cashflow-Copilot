// SplitBooks money logic — pure functions, no DOM, no Supabase.
// Loaded by app.html and demo.html (window.SBCalc) and by the Node tests
// (tests/calc.test.js). Keep it dependency-free so both can use it as is.
//
// A transaction here is the shape app.html builds in loadTransactions():
//   { type: 'income'|'expense'|'draw'|'transfer', status: 'pending'|'verified'|'rejected',
//     amount: Number, account: 'Bank'|'Cash'|..., partnerSlot: 'owner'|'member', project }
//
// All arithmetic is done in integer cents (grosze) so sums never drift and
// the two partners' shares always add up exactly to what is being split.
// Results are returned in normal currency units (e.g. 12.34).
(function (root) {
  'use strict';

  function toCents(x) { return Math.round(x * 100); }
  function fromCents(c) { return c / 100; }

  function sumCents(txs, pred) {
    return txs.filter(pred).reduce(function (s, t) { return s + toCents(t.amount); }, 0);
  }

  // Sign of a transaction for account balances. Transfers count as 0 here
  // (a transfer row has a single account, so it cannot move money between
  // two accounts on its own).
  function signedAmount(t) {
    if (t.type === 'income') return t.amount;
    if (t.type === 'expense' || t.type === 'draw') return -t.amount;
    return 0;
  }

  // Organisation-wide totals and partner balances (verified transactions only).
  // Same model as a single project (computeProjectSplit): a partner's draws
  // are payment for their work; what is left after expenses, the tax reserve
  // and both partners' work payments is split by share. The remainder is not
  // floored at 0 - if work payments exceed profit, the loss is shared too.
  function computeTotals(txs, opts) {
    var verified = function (t) { return t.status === 'verified'; };
    var income = sumCents(txs, function (t) { return t.type === 'income' && verified(t); });
    var expenses = sumCents(txs, function (t) { return t.type === 'expense' && verified(t); });
    var split = computeProjectSplit(txs, opts, ['verified']);
    return {
      income: fromCents(income),
      expenses: fromCents(expenses),
      net: fromCents(income - expenses),
      reserve: split.reserve,
      distributable: split.remainder,
      partnerA: { labor: split.laborA, share: split.shareA, total: fromCents(toCents(split.laborA) + toCents(split.shareA)) },
      partnerB: { labor: split.laborB, share: split.shareB, total: fromCents(toCents(split.laborB) + toCents(split.shareB)) },
      bank: accountBalance(txs, 'Bank'),
      cash: accountBalance(txs, 'Cash')
    };
  }

  // Balance of one account from verified transactions.
  function accountBalance(txs, account) {
    return fromCents(txs
      .filter(function (t) { return t.account === account && t.status === 'verified'; })
      .reduce(function (s, t) { return s + toCents(signedAmount(t)); }, 0));
  }

  // Partner split for the transactions of one project, counting only the
  // given statuses (e.g. ['verified'] or ['verified','pending'] for a forecast).
  // Here draws are treated as payment for work on the project: each partner
  // gets their draws plus their share of what remains after labor and reserve.
  function computeProjectSplit(txs, opts, statuses) {
    var ok = function (t) { return statuses.indexOf(t.status) !== -1; };
    var inc = sumCents(txs, function (t) { return t.type === 'income' && ok(t); });
    var exp = sumCents(txs, function (t) { return t.type === 'expense' && ok(t); });
    var laborA = sumCents(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'owner'; });
    var laborB = sumCents(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'member'; });
    var net = inc - exp;
    var reserve = Math.round(Math.max(0, net) * opts.taxRate / 100);
    var remainder = net - reserve - laborA - laborB;
    var shareA = Math.round(remainder * opts.shareA / 100);
    // When the shares cover 100 %, B gets exactly the rest, so A + B == remainder
    // to the cent (no grosz lost or invented by rounding).
    var shareB = opts.shareA + opts.shareB === 100 ? remainder - shareA : Math.round(remainder * opts.shareB / 100);
    return {
      laborA: fromCents(laborA),
      laborB: fromCents(laborB),
      reserve: fromCents(reserve),
      remainder: fromCents(remainder),
      shareA: fromCents(shareA),
      shareB: fromCents(shareB)
    };
  }

  // Income and cost of a set of transactions (e.g. one project) for the
  // project cards, the project modal and the project export. Verified only,
  // same rule as every balance: pending is not money yet, rejected never is.
  function projectTotals(txs) {
    var ok = function (t) { return t.status === 'verified'; };
    var income = sumCents(txs, function (t) { return t.type === 'income' && ok(t); });
    var cost = sumCents(txs, function (t) { return t.type === 'expense' && ok(t); });
    return { income: fromCents(income), cost: fromCents(cost), net: fromCents(income - cost) };
  }

  var api = {
    signedAmount: signedAmount,
    computeTotals: computeTotals,
    accountBalance: accountBalance,
    computeProjectSplit: computeProjectSplit,
    projectTotals: projectTotals
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBCalc = api;
})(typeof window !== 'undefined' ? window : this);
