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
  // Same model as a single project (computeProjectSplit), which depends on
  // opts.drawMode (see there). partnerX.total is what the card shows last:
  // 'labor' -> work payment + share; 'advance' -> share still to pay out.
  function computeTotals(txs, opts) {
    var verified = function (t) { return t.status === 'verified'; };
    var income = sumCents(txs, function (t) { return t.type === 'income' && verified(t); });
    var expenses = sumCents(txs, function (t) { return t.type === 'expense' && verified(t); });
    var split = computeSplitByPeriods(txs, opts, ['verified'], opts.sharePeriods);
    return {
      income: fromCents(income),
      expenses: fromCents(expenses),
      net: fromCents(income - expenses),
      reserve: split.reserve,
      distributable: split.remainder,
      partnerA: { labor: split.laborA, share: split.shareA, total: split.totalA },
      partnerB: { labor: split.laborB, share: split.shareB, total: split.totalB },
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
  // opts.drawMode decides what a partner's draws are:
  //   'labor' (default): payment for work, on top of the share. The share is
  //     split from what remains after the reserve and both work payments, not
  //     floored at 0 - if work payments exceed profit, the loss is shared too.
  //     total = draws + share.
  //   'advance': an advance out of the partner's own share. The share is split
  //     from net - reserve; total = share - draws (what is still to pay out;
  //     negative = overpaid).
  function computeProjectSplit(txs, opts, statuses) {
    var ok = function (t) { return statuses.indexOf(t.status) !== -1; };
    var inc = sumCents(txs, function (t) { return t.type === 'income' && ok(t); });
    var exp = sumCents(txs, function (t) { return t.type === 'expense' && ok(t); });
    var laborA = sumCents(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'owner'; });
    var laborB = sumCents(txs, function (t) { return t.type === 'draw' && ok(t) && t.partnerSlot === 'member'; });
    var net = inc - exp;
    var reserve = Math.round(Math.max(0, net) * opts.taxRate / 100);
    var advance = opts.drawMode === 'advance';
    var remainder = advance ? net - reserve : net - reserve - laborA - laborB;
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
      shareB: fromCents(shareB),
      totalA: fromCents(advance ? shareA - laborA : shareA + laborA),
      totalB: fromCents(advance ? shareB - laborB : shareB + laborB)
    };
  }

  // Partner split when the shares changed over time (table share_periods).
  // periods: [{ from: 'YYYY-MM-DD', shareA }], shareB = 100 - shareA.
  // Each transaction belongs to the last period starting on or before its
  // date (earlier dates fall into the first period). Each period is split
  // with its own shares by computeProjectSplit and the results are summed,
  // so a change of shares never re-splits money from before its start date.
  // Note: the tax reserve is then counted per period (on that period's net).
  // With no periods, the old single split over the whole history is used.
  var SPLIT_KEYS = ['laborA', 'laborB', 'reserve', 'remainder', 'shareA', 'shareB', 'totalA', 'totalB'];
  function computeSplitByPeriods(txs, opts, statuses, periods) {
    if (!periods || periods.length === 0) return computeProjectSplit(txs, opts, statuses);
    var ps = periods.slice().sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    var groups = ps.map(function () { return []; });
    txs.forEach(function (t) {
      var i = 0;
      for (var k = 1; k < ps.length; k++) if (String(t.date || '') >= ps[k].from) i = k;
      groups[i].push(t);
    });
    var sum = {};
    SPLIT_KEYS.forEach(function (key) { sum[key] = 0; });
    ps.forEach(function (p, i) {
      var shareA = Number(p.shareA);
      var r = computeProjectSplit(groups[i], {
        taxRate: opts.taxRate, drawMode: opts.drawMode, shareA: shareA, shareB: 100 - shareA
      }, statuses);
      SPLIT_KEYS.forEach(function (key) { sum[key] += toCents(r[key]); });
    });
    SPLIT_KEYS.forEach(function (key) { sum[key] = fromCents(sum[key]); });
    return sum;
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

  // Contract of one project: the agreed amount, what has come in (verified
  // income only, same rule as projectTotals) and what is still owed.
  // remaining < 0 means the client paid more than agreed (extra work).
  // Returns null when no contract amount is set, so the card shows nothing.
  function contractStatus(contractAmount, txs) {
    if (!contractAmount) return null;
    var contract = toCents(contractAmount);
    var received = sumCents(txs, function (t) { return t.type === 'income' && t.status === 'verified'; });
    return { contract: fromCents(contract), received: fromCents(received), remaining: fromCents(contract - received) };
  }

  // Shares actually used for display and money while the organisation is
  // solo (no partner has accepted the invite yet): the owner keeps 100 %.
  // The stored shares stay as they are (the invite offers 100 - shareA).
  function effectiveShares(shareA, shareB, hasPartner) {
    if (!hasPartner) return { shareA: 100, shareB: 0 };
    return { shareA: shareA, shareB: shareB };
  }

  // True if any non-rejected "Partner Draw B" row exists. Such draws are
  // subtracted in the totals even in a solo org, so partner B must stay visible.
  function hasMemberDraws(txs) {
    return txs.some(function (t) { return t.type === 'draw' && t.partnerSlot === 'member' && t.status !== 'rejected'; });
  }

  var api = {
    signedAmount: signedAmount,
    computeTotals: computeTotals,
    accountBalance: accountBalance,
    computeProjectSplit: computeProjectSplit,
    computeSplitByPeriods: computeSplitByPeriods,
    projectTotals: projectTotals,
    contractStatus: contractStatus,
    effectiveShares: effectiveShares,
    hasMemberDraws: hasMemberDraws
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBCalc = api;
})(typeof window !== 'undefined' ? window : this);
