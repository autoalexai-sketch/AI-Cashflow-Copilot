// SplitBooks money logic — pure functions, no DOM, no Supabase.
// Loaded by app.html and demo.html (window.SBCalc) and by the Node tests
// (tests/calc.test.js). Keep it dependency-free so both can use it as is.
//
// A transaction here is the shape app.html builds in loadTransactions():
//   { type: 'income'|'expense'|'draw'|'transfer', status: 'pending'|'verified'|'rejected',
//     amount: Number, account: 'Bank'|'Cash'|..., partnerSlot: 'owner'|'member', project }
(function (root) {
  'use strict';

  function sum(txs, pred) {
    return txs.filter(pred).reduce(function (s, t) { return s + t.amount; }, 0);
  }

  // Sign of a transaction for account balances. Transfers count as 0 here
  // (a transfer row has a single account, so it cannot move money between
  // two accounts on its own).
  function signedAmount(t) {
    if (t.type === 'income') return t.amount;
    if (t.type === 'expense' || t.type === 'draw') return -t.amount;
    return 0;
  }

  // Organisation-wide totals and partner balances.
  // Only 'verified' transactions count; 'pending' and 'rejected' never do.
  // Draws are advances against a partner's earned share: they do not reduce
  // the distributable profit, they reduce what is left for that partner.
  function computeTotals(txs, opts) {
    var verified = function (t) { return t.status === 'verified'; };
    var income = sum(txs, function (t) { return t.type === 'income' && verified(t); });
    var expenses = sum(txs, function (t) { return t.type === 'expense' && verified(t); });
    var drawA = sum(txs, function (t) { return t.type === 'draw' && verified(t) && t.partnerSlot === 'owner'; });
    var drawB = sum(txs, function (t) { return t.type === 'draw' && verified(t) && t.partnerSlot === 'member'; });
    var net = income - expenses;
    var reserve = Math.max(0, net) * opts.taxRate / 100;
    var distributable = Math.max(0, net - reserve);
    var earnedA = distributable * opts.shareA / 100;
    var earnedB = distributable * opts.shareB / 100;
    return {
      income: income,
      expenses: expenses,
      net: net,
      reserve: reserve,
      distributable: distributable,
      partnerA: { earned: earnedA, withdrawn: drawA, remaining: earnedA - drawA },
      partnerB: { earned: earnedB, withdrawn: drawB, remaining: earnedB - drawB },
      bank: accountBalance(txs, 'Bank'),
      cash: accountBalance(txs, 'Cash')
    };
  }

  // Balance of one account from verified transactions.
  function accountBalance(txs, account) {
    return txs
      .filter(function (t) { return t.account === account && t.status === 'verified'; })
      .reduce(function (s, t) { return s + signedAmount(t); }, 0);
  }

  // Partner split for the transactions of one project, counting only the
  // given statuses (e.g. ['verified'] or ['verified','pending'] for a forecast).
  // Here draws are treated as payment for work on the project: each partner
  // gets their draws plus their share of what remains after labor and reserve.
  function computeProjectSplit(txs, opts, statuses) {
    var ok = function (t) { return statuses.indexOf(t.status) !== -1; };
    var inc = sum(txs, function (t) { return t.type === 'income' && ok(t); });
    var exp = sum(txs, function (t) { return t.type === 'expense' && ok(t); });
    var laborA = sum(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'owner'; });
    var laborB = sum(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'member'; });
    var net = inc - exp;
    var reserve = Math.max(0, net) * opts.taxRate / 100;
    var remainder = net - reserve - laborA - laborB;
    return {
      laborA: laborA,
      laborB: laborB,
      reserve: reserve,
      shareA: remainder * opts.shareA / 100,
      shareB: remainder * opts.shareB / 100
    };
  }

  var api = {
    signedAmount: signedAmount,
    computeTotals: computeTotals,
    accountBalance: accountBalance,
    computeProjectSplit: computeProjectSplit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBCalc = api;
})(typeof window !== 'undefined' ? window : this);
