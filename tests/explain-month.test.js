// "Why this result" under the monthly close: compares one month with the
// previous one and names the biggest changes (no AI, plain arithmetic).
const test = require('node:test');
const assert = require('node:assert/strict');
const { explainMonth } = require('../calc.js');

const cents = (x) => Math.round(x * 100);
const tx = (type, amount, date, extra = {}) => ({
  type, amount, date, status: 'verified', project: '—', category: '—', ...extra
});

const oct = [
  tx('income', 5000, '2026-10-05', { project: 'Kowalski' }),
  tx('expense', 1000, '2026-10-06', { category: 'Materiały' }),
];
const nov = [
  tx('income', 4700, '2026-11-05', { project: 'Kowalski' }),
  tx('expense', 1900, '2026-11-06', { category: 'Materiały' }),
  tx('expense', 50, '2026-11-07', { category: 'Paliwo' }),
];

test('profit change and its biggest reasons, largest impact first', () => {
  const r = explainMonth([...oct, ...nov], '2026-11');
  assert.equal(r.month, '2026-11');
  assert.equal(r.prevMonth, '2026-10');
  assert.equal(cents(r.profit), cents(2750));
  assert.equal(cents(r.prevProfit), cents(4000));
  assert.equal(cents(r.delta), cents(-1250));
  assert.deepEqual(r.reasons.map(x => [x.kind, x.label, cents(x.change), cents(x.impact)]), [
    ['expense', 'Materiały', cents(900), cents(-900)],
    ['income', '', cents(-300), cents(-300)],
    ['expense', 'Paliwo', cents(50), cents(-50)],
  ]);
});

test('income is one line with the number of jobs, not one line per project', () => {
  const r = explainMonth([
    tx('income', 8400, '2026-06-03', { project: 'Osiek' }),
    tx('income', 4860, '2026-06-08', { project: 'Modlnica' }),
    tx('income', 4500, '2026-07-07', { project: 'Łamana' }),
  ], '2026-07');
  assert.equal(r.reasons.length, 1);
  const inc = r.reasons[0];
  assert.equal(inc.kind, 'income');
  assert.equal(cents(inc.change), cents(4500 - 13260));
  assert.equal(inc.jobs, 1);
  assert.equal(inc.prevJobs, 2);
});

test('at most 3 reasons', () => {
  const extra = ['A', 'B', 'C', 'D'].map((c, i) => tx('expense', 10 * (i + 1), '2026-11-08', { category: c }));
  const r = explainMonth([...oct, ...nov, ...extra], '2026-11');
  assert.equal(r.reasons.length, 3);
});

test('pending and rejected rows do not count', () => {
  const r = explainMonth([...oct, ...nov,
    tx('income', 9999, '2026-11-09', { status: 'pending' }),
    tx('expense', 9999, '2026-11-09', { status: 'rejected' })], '2026-11');
  assert.equal(cents(r.profit), cents(2750));
});

test('draws are not a cost of the business', () => {
  const r = explainMonth([...oct, ...nov, tx('draw', 3000, '2026-11-10')], '2026-11');
  assert.equal(cents(r.profit), cents(2750));
});

test('January compares with December of the year before', () => {
  const r = explainMonth([tx('income', 100, '2025-12-03'), tx('income', 300, '2026-01-04')], '2026-01');
  assert.equal(r.prevMonth, '2025-12');
  assert.equal(cents(r.delta), cents(200));
});

test('first month with data: prevEmpty, reasons still listed', () => {
  const r = explainMonth(nov, '2026-11');
  assert.equal(r.prevEmpty, true);
  assert.equal(cents(r.delta), cents(2750));
  assert.ok(r.reasons.length > 0);
});

test('no data in either month: null', () => {
  assert.equal(explainMonth(oct, '2027-03'), null);
});

test('unchanged lines are left out', () => {
  const r = explainMonth([tx('income', 100, '2026-10-01'), tx('income', 100, '2026-11-01')], '2026-11');
  assert.equal(r.reasons.length, 0);
  assert.equal(cents(r.delta), 0);
});

test('latestDataMonth: last month with verified income or expense', () => {
  const { latestDataMonth } = require('../calc.js');
  assert.equal(latestDataMonth([...oct, ...nov]), '2026-11');
  assert.equal(latestDataMonth([...oct, tx('income', 5, '2026-12-01', { status: 'pending' }), tx('draw', 5, '2026-12-02')]), '2026-10');
  assert.equal(latestDataMonth([]), null);
});
