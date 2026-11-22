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
    var split = computeSplitByPeriods(txs, opts, ['verified'], opts.sharePeriods, opts.taxPeriods);
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

  // Partner split when the shares or the tax rate changed over time
  // (tables share_periods and tax_periods).
  //   sharePeriods: [{ from: 'YYYY-MM-DD', shareA }], shareB = 100 - shareA
  //   taxPeriods:   [{ from: 'YYYY-MM-DD', taxRate }]
  // The history is cut at every start date of either list. Each piece is
  // split by computeProjectSplit with the shares and rate in force on its
  // start date, and the results are summed, so a change never re-counts
  // money from before its start date. A transaction belongs to the last
  // piece starting on or before its date (earlier dates: the first piece).
  // A missing or empty list means opts.shareA/shareB or opts.taxRate apply
  // everywhere. With neither list it is the old single split.
  // Note: the tax reserve is then counted per piece (on that piece's net).
  var SPLIT_KEYS = ['laborA', 'laborB', 'reserve', 'remainder', 'shareA', 'shareB', 'totalA', 'totalB'];
  function byFrom(a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; }
  function inForce(list, date) {
    var hit = list[0];
    for (var k = 1; k < list.length; k++) if (list[k].from <= date) hit = list[k];
    return hit;
  }
  function computeSplitByPeriods(txs, opts, statuses, sharePeriods, taxPeriods) {
    var sp = (sharePeriods || []).slice().sort(byFrom);
    var tp = (taxPeriods || []).slice().sort(byFrom);
    if (sp.length === 0 && tp.length === 0) return computeProjectSplit(txs, opts, statuses);
    var starts = sp.concat(tp).map(function (p) { return p.from; }).sort();
    starts = starts.filter(function (d, i) { return i === 0 || d !== starts[i - 1]; });
    var groups = starts.map(function () { return []; });
    txs.forEach(function (t) {
      var d = String(t.date || ''), i = 0;
      for (var k = 1; k < starts.length; k++) if (d >= starts[k]) i = k;
      groups[i].push(t);
    });
    var sum = {};
    SPLIT_KEYS.forEach(function (key) { sum[key] = 0; });
    starts.forEach(function (from, i) {
      var o = { taxRate: opts.taxRate, drawMode: opts.drawMode, shareA: opts.shareA, shareB: opts.shareB };
      if (sp.length) { o.shareA = Number(inForce(sp, from).shareA); o.shareB = 100 - o.shareA; }
      if (tp.length) o.taxRate = Number(inForce(tp, from).taxRate);
      var r = computeProjectSplit(groups[i], o, statuses);
      SPLIT_KEYS.forEach(function (key) { sum[key] += toCents(r[key]); });
    });
    SPLIT_KEYS.forEach(function (key) { sum[key] = fromCents(sum[key]); });
    return sum;
  }

  // "Why this result" for one month ('YYYY-MM') against the month before.
  // Profit = verified income - verified expenses (draws are payouts, not a
  // cost of the business). Income is one line (jobs change every month for
  // crews, so per-project lines would be noise) with the number of jobs
  // (distinct projects with income); expenses are grouped by category
  // (fallback: project, then '—'). Reasons = lines that changed, biggest
  // effect on profit first, at most 3. Null when both months are empty.
  function prevYearMonth(ym) {
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1;
    if (m === 0) { y -= 1; m = 12; }
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  // Latest 'YYYY-MM' with a verified income or expense, or null.
  function latestDataMonth(txs) {
    var best = null;
    txs.forEach(function (t) {
      if (t.status !== 'verified' || (t.type !== 'income' && t.type !== 'expense')) return;
      var ym = String(t.date || '').slice(0, 7);
      if (ym.length === 7 && (best === null || ym > best)) best = ym;
    });
    return best;
  }
  function explainMonth(txs, month) {
    var prev = prevYearMonth(month);
    var named = function (v) { return v && v !== '—' ? v : ''; };
    var cur = {}, old = {}, jobs = { cur: {}, old: {} }, curProfit = 0, oldProfit = 0, curN = 0, oldN = 0;
    txs.forEach(function (t) {
      if (t.status !== 'verified' || (t.type !== 'income' && t.type !== 'expense')) return;
      var ym = String(t.date || '').slice(0, 7);
      if (ym !== month && ym !== prev) return;
      var isCur = ym === month;
      var key = t.type === 'income' ? 'income|' : 'expense|' + (named(t.category) || named(t.project) || '—');
      var c = toCents(t.amount);
      var bucket = isCur ? cur : old;
      bucket[key] = (bucket[key] || 0) + c;
      if (t.type === 'income') (isCur ? jobs.cur : jobs.old)[named(t.project) || ('#' + (isCur ? curN : oldN))] = true;
      if (isCur) { curProfit += t.type === 'income' ? c : -c; curN++; } else { oldProfit += t.type === 'income' ? c : -c; oldN++; }
    });
    if (curN === 0 && oldN === 0) return null;
    var keys = Object.keys(cur).concat(Object.keys(old).filter(function (k) { return !(k in cur); }));
    var reasons = keys.map(function (k) {
      var kind = k.slice(0, k.indexOf('|')), label = k.slice(k.indexOf('|') + 1);
      var change = (cur[k] || 0) - (old[k] || 0);
      var r = { kind: kind, label: label, change: change, impact: kind === 'income' ? change : -change };
      if (kind === 'income') { r.jobs = Object.keys(jobs.cur).length; r.prevJobs = Object.keys(jobs.old).length; }
      return r;
    }).filter(function (r) { return r.change !== 0; });
    reasons.sort(function (a, b) { return Math.abs(b.impact) - Math.abs(a.impact) || (a.label < b.label ? -1 : 1); });
    return {
      month: month,
      prevMonth: prev,
      prevEmpty: oldN === 0,
      profit: fromCents(curProfit),
      prevProfit: fromCents(oldProfit),
      delta: fromCents(curProfit - oldProfit),
      reasons: reasons.slice(0, 3).map(function (r) {
        var o = { kind: r.kind, label: r.label, change: fromCents(r.change), impact: fromCents(r.impact) };
        if (r.kind === 'income') { o.jobs = r.jobs; o.prevJobs = r.prevJobs; }
        return o;
      })
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
    explainMonth: explainMonth,
    latestDataMonth: latestDataMonth,
    projectTotals: projectTotals,
    contractStatus: contractStatus,
    effectiveShares: effectiveShares,
    hasMemberDraws: hasMemberDraws
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SBCalc = api;
})(typeof window !== 'undefined' ? window : this);
