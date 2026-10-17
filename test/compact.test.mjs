import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DROP_ORDER, FALLBACK_GAP, MAX_DROP_LEVEL, minimumRowWidth, nextCompactLevel, pickCompactLevel, shouldUseDock } from '../src/client/compact.js'

/** 一次典型测量的各部分宽度（px，接近真实渲染值）。 */
const parts = { session: 78, countdown: 62, balance: 104, balanceLabel: 26, period: 34 }
const total = 190 + 78 + 62 + 104 + 34 + FALLBACK_GAP * 3 // 花费 190 + 其余 + 间距

test('放得下就是级别 0，一点不缩', () => {
  assert.equal(pickCompactLevel({ room: total, total, parts }), 0)
  assert.equal(pickCompactLevel({ room: total + 500, total, parts }), 0)
})

test('逐级丢：倒计时 → 会话总额 → 「余额」标签，最多丢到这三步', () => {
  assert.equal(pickCompactLevel({ room: total - 1, total, parts }), 1)
  assert.equal(pickCompactLevel({ room: total - parts.countdown - FALLBACK_GAP - 1, total, parts }), 2)
  // 丢嵌在 pill 里的片段不省间距（见 remainingWidthAt），记账只减片段自身宽度
  const dropped3 = parts.countdown + parts.session + parts.balanceLabel
  assert.equal(pickCompactLevel({ room: total - dropped3, total, parts }), 3)
  // 再放不下也**不丢时段**：交给 shouldUseDock 退回槽位，而不是在这一行硬挤
  assert.equal(pickCompactLevel({ room: 10, total, parts }), MAX_DROP_LEVEL)
  assert.equal(pickCompactLevel({ room: -100, total, parts }), MAX_DROP_LEVEL)
})

test('缺项按 0 处理，宽度量不到时不缩', () => {
  assert.equal(pickCompactLevel({ room: 100, total: 200, parts: {} }), MAX_DROP_LEVEL)
  assert.equal(pickCompactLevel({ room: Number.NaN, total: 200, parts }), 0)
  assert.equal(pickCompactLevel({ room: 100, total: Number.NaN, parts }), 0)
})

test('最少要保住的三样（本轮 + 时段 + 余额）宽度合计', () => {
  assert.equal(minimumRowWidth({ cost: 190, period: 127, balance: 73, gap: 10 }), 410)
  assert.equal(minimumRowWidth({}), 0)
})

test('缩略顺序固定：余额的数字留到最后，只丢它的标签', () => {
  assert.deepEqual(DROP_ORDER, ['countdown', 'session', 'balanceLabel', 'word', 'period'])
})

test('空间不够就退回自己的槽位；门槛与余量都由量出来的宽度算', () => {
  const minWidth = minimumRowWidth({ cost: 190, period: 127, balance: 73, gap: 10 })   // ≈410
  assert.ok(minWidth > 190 + 127, '门槛要覆盖「本轮 + 时段 + 余额」三样')
  assert.equal(shouldUseDock({ room: 600, minWidth, wasDock: false }), false, '余量够：挤进那一行')
  assert.equal(shouldUseDock({ room: 200, minWidth, wasDock: false }), true, '余量不够：退回自己槽位')
  assert.equal(shouldUseDock({ room: 430, minWidth, wasDock: false }), false, '剩余 430：够放三样')
  assert.equal(shouldUseDock({ room: 380, minWidth, wasDock: false }), true, '只剩 380（不够三样）：退回槽位，别在这一行硬挤')
  assert.equal(shouldUseDock({ room: 240, minWidth, wasDock: true }), true, '已退回、余量不足两成：继续留在槽位')
  assert.equal(shouldUseDock({ room: 600, minWidth, wasDock: true }), false, '余量够了才切回那一行')
  assert.equal(shouldUseDock({ room: Number.NaN, minWidth, wasDock: true }), true)
  // 量不到宽度（首帧 / display:contents 包装层）时保持上一轮判断，不能凭 0 改判
  assert.equal(shouldUseDock({ rowWidth: 0, room: -20, minWidth, wasDock: false }), false)
  assert.equal(shouldUseDock({ rowWidth: 0, room: -20, minWidth, wasDock: true }), true)
})

test('门槛与余量随字号缩放：1.5 倍字号下同步放大，不是固定 px', () => {
  const small = minimumRowWidth({ cost: 190, period: 127, balance: 73, gap: 10 })
  const large = minimumRowWidth({ cost: 190 * 1.5, period: 127 * 1.5, balance: 73 * 1.5, gap: 15 })
  assert.ok(large > small * 1.4, '门槛按比例走（间距也放大，故略高于 1.5 倍）')
  // 同一个剩余宽度：小字号够、大字号不够
  assert.equal(shouldUseDock({ room: 600, minWidth: small, wasDock: false }), false)
  assert.equal(shouldUseDock({ room: 600, minWidth: large, wasDock: false }), true)
})

test('级别推进带迟滞：变紧立刻，放宽要留一成余量', () => {
  const room = total - 1 // 只够级别 1
  assert.equal(nextCompactLevel({ room, total, parts, current: 0 }), 1, '紧了就立刻缩')
  assert.equal(nextCompactLevel({ room: total + 10, total, parts, current: 1 }), 1, '只多 10px：先不动，别来回跳')
  assert.equal(nextCompactLevel({ room: total + 80, total, parts, current: 1 }), 0, '余量够了才放宽')
  assert.equal(nextCompactLevel({ room: 10, total, parts, current: 1 }), MAX_DROP_LEVEL, '更紧继续缩，但保底不丢时段')
})

test('稳定性：数字慢慢长大时级别只缩一次，不会来回跳', () => {
  const room = 380
  let level = 0
  const seen = []
  // 金额在长（total 变大），中间又有回落——级别必须单调变紧，不许弹回
  for (const width of [370, 380, 390, 400, 410, 420, 400, 380, 360]) {
    level = nextCompactLevel({ room, total: width, parts, current: level })
    seen.push(level)
  }
  assert.deepEqual(seen, [0, 0, 1, 1, 1, 1, 1, 1, 1])
})

test('稳定性：行宽在同一档内小幅抖动，落点不来回切', () => {
  const rowWidth = 680
  const core = 280
  const need = 320
  let dock = false
  const seen = []
  for (const jitter of [0, -10, +10, -20, +5]) {
    const room = rowWidth + jitter - core - 20
    dock = shouldUseDock({ room, minWidth: need, wasDock: dock })
    seen.push(dock)
  }
  assert.deepEqual(seen, [false, false, false, false, false], '实测场景（余量 380）不该触发退回')
})
