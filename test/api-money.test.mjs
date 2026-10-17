import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCents, parseAmountToCents, sumWallets } from '../src/client/api.js'

test('余额串 → 整数分：平台允许的奇怪写法都要认', () => {
  assert.equal(parseAmountToCents('93.06'), 9306)
  assert.equal(parseAmountToCents('196.60'), 19660)
  assert.equal(parseAmountToCents('5.0000000000000000'), 500)
  assert.equal(parseAmountToCents('0E-16'), 0)
  assert.equal(parseAmountToCents('289.669'), 28966, '分以下截断（与平台 roundDown 一致）')
  assert.equal(parseAmountToCents(''), null)
  assert.equal(parseAmountToCents('abc'), null)
})

test('余额合计 = 充值 + 赠送，用整数分相加（浮点会少一分）', () => {
  assert.equal(93.06 + 196.60, 289.65999999999997, '这就是不能用浮点的原因')
  const total = sumWallets([{ currency: 'CNY', balance: '93.06' }], [{ currency: 'CNY', balance: '196.60' }])
  assert.equal(total.cents, 28966)
  assert.equal(total.topUpCents, 9306)
  assert.equal(total.bonusCents, 19660)
  assert.equal(formatCents(total.cents, 'CNY'), '¥289.66')
})

test('多币种分别求和，取有余额的那个', () => {
  const total = sumWallets(
    [{ currency: 'USD', balance: '0.00' }, { currency: 'CNY', balance: '10.00' }],
    [{ currency: 'CNY', balance: '0.50' }],
  )
  assert.equal(total.currency, 'CNY')
  assert.equal(total.cents, 1050)
})

test('金额显示：千分位、零、负数', () => {
  assert.equal(formatCents(0, 'CNY'), '¥0.00')
  assert.equal(formatCents(1, 'CNY'), '¥0.01')
  assert.equal(formatCents(1234567, 'CNY'), '¥12,345.67')
  assert.equal(formatCents(-500, 'USD'), '-$5.00')
})
