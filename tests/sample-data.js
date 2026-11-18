// Example data (same values as the owner's prototype sheet) for screenshots and device tests.
'use strict';
function seed(C, store, month) {
  const m = month, nx = C.addMonths(m, 1);
  const bank = store.addDebt('Bank loan', 500000, m);
  const max = store.addDebt('Max (friend)', 80000, m);
  const card = store.addDebt('Credit card', 120000, m);
  store.setPayment(bank.id, m, 25000); store.setPayment(max.id, m, 10000); store.setPayment(card.id, m, 30000);
  store.setPayment(bank.id, nx, 25000); store.setPayment(card.id, nx, 40000);
  store.addBorrow(max.id, nx, 15000, 'car repair', true);
  store.addItem('income', 'Salary', '', true, m, 250000);
  store.addItem('income', 'Side job', '', true, m, 30000);
  store.addItem('cost', 'Rent', 'Rent', true, m, 90000);
  store.addItem('cost', 'Electricity', 'Utilities', true, m, 6500);
  store.addItem('cost', 'Groceries', 'Food', true, m, 35000);
  store.addItem('cost', 'Monthly ticket', 'Transport', true, m, 5800);
  store.addItem('cost', 'Christmas gifts', 'Other', false, nx, 20000);
  store.addItem('sub', 'Phone plan', '', true, m, 1500, 1);
  store.addItem('sub', 'Streaming', '', true, m, 1399, 1);
  store.addItem('sub', 'Cloud storage', '', true, m, 2999, 12);
  return { bank, max, card };
}
if (typeof module !== 'undefined') module.exports = { seed };
