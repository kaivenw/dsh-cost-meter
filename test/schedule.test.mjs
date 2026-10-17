import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HOLIDAYS,
  formatCountdown,
  isPeakAt,
  nextPeriodChangeAt,
  normalizeSchedule,
  parseWindow,
  periodAt,
} from '../src/shared/schedule.js'

/** 北京时间 → epoch 毫秒（北京时间 = UTC+8，无夏令时）。 */
function beijing(text) {
  const matched = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text)
  assert.ok(matched, `测试用例时间写法：${text}`)
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4]) - 8, Number(matched[5]))
}

const schedule = normalizeSchedule({})

test('高峰窗口解析：非法写法必须在加载时报错，不静默跳过', () => {
  assert.deepEqual(parseWindow('09:00-12:00'), [540, 720])
  assert.throws(() => parseWindow('9-12'), /HH:MM-HH:MM/)
  assert.throws(() => parseWindow('12:00-09:00'), /起止颠倒/)
})

test('工作日高峰窗口内为波峰，窗口边界按左闭右开', () => {
  // 2026-10-16 是周五（非节假日）。
  assert.equal(periodAt(beijing('2026-10-16 08:59'), schedule), 'offPeak')
  assert.equal(periodAt(beijing('2026-10-16 09:00'), schedule), 'peak')
  assert.equal(periodAt(beijing('2026-10-16 11:59'), schedule), 'peak')
  assert.equal(periodAt(beijing('2026-10-16 12:00'), schedule), 'offPeak')
  assert.equal(periodAt(beijing('2026-10-16 13:59'), schedule), 'offPeak')
  assert.equal(periodAt(beijing('2026-10-16 14:00'), schedule), 'peak')
  assert.equal(periodAt(beijing('2026-10-16 17:59'), schedule), 'peak')
  assert.equal(periodAt(beijing('2026-10-16 18:00'), schedule), 'offPeak')
})

test('周末整天为波谷，即使落在高峰钟点', () => {
  assert.equal(periodAt(beijing('2026-10-17 10:00'), schedule), 'offPeak') // 周六
  assert.equal(periodAt(beijing('2026-10-18 15:00'), schedule), 'offPeak') // 周日
})

test('法定节假日整天为波谷（含工作日）', () => {
  // 2026-10-01 是周四，在国庆假期内；10-08 是周四，不在假期内。
  assert.equal(isPeakAt(beijing('2026-10-01 10:00'), schedule), false)
  assert.equal(isPeakAt(beijing('2026-10-06 15:00'), schedule), false)
  assert.equal(isPeakAt(beijing('2026-10-08 10:00'), schedule), true)
  // 调休上班的周六（2026-10-10）不是 Mon–Fri，仍是波谷。
  assert.equal(isPeakAt(beijing('2026-10-10 10:00'), schedule), false)
})

test('节假日表覆盖 2026 年七段假期', () => {
  for (const day of ['2026-01-01', '2026-02-17', '2026-04-06', '2026-05-04', '2026-06-20', '2026-09-26', '2026-10-07']) {
    assert.ok(DEFAULT_HOLIDAYS.includes(day), `${day} 应在节假日表内`)
  }
  assert.equal(DEFAULT_HOLIDAYS.length, 33)
})

test('下一次切换点：窗口起止与跨周末都要准', () => {
  const at = (text) => nextPeriodChangeAt(beijing(text), schedule)
  assert.equal(at('2026-10-16 08:00'), beijing('2026-10-16 09:00'))
  assert.equal(at('2026-10-16 11:59'), beijing('2026-10-16 12:00'))
  assert.equal(at('2026-10-16 13:00'), beijing('2026-10-16 14:00'))
  assert.equal(at('2026-10-16 17:59'), beijing('2026-10-16 18:00'))
  // 周五傍晚之后要跳过整段周末，落到下周一 09:00。
  assert.equal(at('2026-10-16 18:30'), beijing('2026-10-19 09:00'))
  // 假期内的工作日不切换，直到假期结束后的 09:00。
  assert.equal(at('2026-10-07 10:00'), beijing('2026-10-08 09:00'))
})

test('切换点自身仍然属于新时段（不留空档）', () => {
  const switchAt = nextPeriodChangeAt(beijing('2026-10-16 08:00'), schedule)
  assert.equal(beijing('2026-10-16 09:00'), switchAt)
  assert.equal(isPeakAt(switchAt, schedule), true)
})

test('自定义高峰窗口与偏移生效', () => {
  const custom = normalizeSchedule({ peakWindows: ['00:00-23:59'], offsetMinutes: 0 })
  assert.equal(periodAt(Date.UTC(2026, 9, 16, 3, 0), custom), 'peak') // UTC 周五 03:00
  assert.equal(periodAt(Date.UTC(2026, 9, 17, 3, 0), custom), 'offPeak') // UTC 周六
  assert.throws(() => normalizeSchedule({ holidays: ['2026/10/01'] }), /YYYY-MM-DD/)
})

test('倒计时文案按量级切换单位', () => {
  assert.equal(formatCountdown(20_000), '20s')
  assert.equal(formatCountdown(80_000), '1m20s')
  assert.equal(formatCountdown(2 * 3600_000 + 13 * 60_000), '2h13m')
})
