/**
 * 波峰（高峰时段）/ 波谷（空闲时段）判定。
 *
 * 判据只有一处：DeepSeek 官方定价页。
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 * “空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）
 *   9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天
 *   均为空闲时段。”
 *
 * 两条推论写在这里，免得后面有人再推一遍：
 *   1. 高峰只认「周一至周五」——调休上班的周六周日不算高峰（它们不是 Mon–Fri）。
 *   2. 法定节假日整日空闲，与是否工作日无关。
 *
 * 时间全部按北京时间（UTC+8，无夏令时）判，不读运行机器的本地时区：
 * 计费的是 DeepSeek 的钟，不是用户机器的钟。
 */

/** 北京时间相对 UTC 的偏移（分钟）。 */
export const BEIJING_OFFSET_MINUTES = 480

/** 高峰时段的默认窗口，本地（北京）钟点。 */
export const DEFAULT_PEAK_WINDOWS = ['09:00-12:00', '14:00-18:00']

/**
 * 默认法定节假日日期（北京时间日历日）。
 * 来源：国务院办公厅《关于2026年部分节假日安排的通知》（国办发明电〔2025〕7号）。
 * 元旦 1/1–1/3、春节 2/15–2/23、清明 4/4–4/6、劳动节 5/1–5/5、
 * 端午 6/19–6/21、中秋 9/25–9/27、国庆 10/1–10/7。
 * 只列放假日期：调休上班的周末不进这张表（它们是周末，本就空闲）。
 * 每年国务院发新通知后需要更新这里——价格不会变，但节假日会。
 */
export const DEFAULT_HOLIDAYS = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07',
]

/** 把 `HH:MM-HH:MM` 解析成 `[起始分钟, 结束分钟]`。结束必须晚于起始。 */
export function parseWindow(text) {
  const matched = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(text).trim())
  if (matched === null) throw new Error(`peakWindows 项不是 HH:MM-HH:MM：${JSON.stringify(text)}`)
  const start = Number(matched[1]) * 60 + Number(matched[2])
  const end = Number(matched[3]) * 60 + Number(matched[4])
  if (start >= end) throw new Error(`peakWindows 项起止颠倒：${JSON.stringify(text)}`)
  return [start, end]
}

/** 日期串必须是 `YYYY-MM-DD`，否则静默失效会把节假日判成工作日。 */
function parseDateKey(text) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim())
  if (matched === null) throw new Error(`holidays 项不是 YYYY-MM-DD：${JSON.stringify(text)}`)
  return `${matched[1]}-${matched[2]}-${matched[3]}`
}

/**
 * 归一化时段配置。缺省值即官方默认：北京时间 9–12、14–18 高峰，节假日按内置表。
 * @param input - 插件配置里的 `schedule` 块，可以整体缺省。
 * @returns 判定函数只依赖的纯数据（日期用 Set，查表 O(1)）。
 */
export function normalizeSchedule(input) {
  const source = input ?? {}
  const windows = (source.peakWindows ?? DEFAULT_PEAK_WINDOWS).map(parseWindow)
  const holidayList = (source.holidays ?? DEFAULT_HOLIDAYS).map(parseDateKey)
  const offsetMinutes = Number.isFinite(source.offsetMinutes) ? Number(source.offsetMinutes) : BEIJING_OFFSET_MINUTES
  return {
    offsetMinutes,
    windows,
    holidayList,
    holidays: new Set(holidayList),
  }
}

/**
 * 从投影线值里的 `schedule` 块重建判定用的纯数据。
 *
 * 客户端不重算单价、也不重算历史金额：那些是宿主的账。但「现在处于波峰还是波谷、
 * 还有多久切换」必须逐秒自算——投影只在有事件落库时推一次，空闲时不会为了走时钟
 * 推帧给它。两边共用本模块，判定规则只有一份。
 *
 * @param wire - 投影 view 里的 `schedule`：`{ offsetMinutes, windows: [[s,e]], holidays: [...] }`。
 */
export function scheduleFromWire(wire) {
  const windows = (wire?.windows ?? []).map(([start, end]) => [Number(start), Number(end)])
  const holidayList = (wire?.holidays ?? []).map(String)
  return {
    offsetMinutes: Number.isFinite(wire?.offsetMinutes) ? Number(wire.offsetMinutes) : BEIJING_OFFSET_MINUTES,
    windows,
    holidayList,
    holidays: new Set(holidayList),
  }
}

/**
 * 把一个瞬时拆成北京时间的日历字段。
 * 用 UTC 取值器读「加了偏移的瞬时」，因此结果与运行机器时区无关。
 * @param ms - Unix epoch 毫秒。
 * @param offsetMinutes - 目标时区偏移，默认 +480。
 */
export function beijingParts(ms, offsetMinutes = BEIJING_OFFSET_MINUTES) {
  const shifted = new Date(ms + offsetMinutes * 60_000)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

/**
 * 某一瞬时是否处于高峰时段。
 * @param ms - Unix epoch 毫秒。
 * @param schedule - {@link normalizeSchedule} 的结果。
 */
export function isPeakAt(ms, schedule) {
  const parts = beijingParts(ms, schedule.offsetMinutes)
  if (parts.weekday === 0 || parts.weekday === 6) return false
  if (schedule.holidays.has(parts.dateKey)) return false
  return schedule.windows.some(([start, end]) => parts.minutes >= start && parts.minutes < end)
}

/**
 * 某一瞬时的时段种类。
 * @returns `'peak'` 或 `'offPeak'`。
 */
export function periodAt(ms, schedule) {
  return isPeakAt(ms, schedule) ? 'peak' : 'offPeak'
}

/** 北京时间的某个日历日零点，换算回 epoch 毫秒。 */
function dayStartMs(dateKey, offsetMinutes) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day) - offsetMinutes * 60_000
}

/** 把 epoch 毫秒按北京时间的日推进 `days` 天，返回新的日期串。 */
function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

/**
 * 下一次时段切换的瞬时。
 *
 * 候选点只有三类：北京时间的日界（跨日会改变工作日/节假日判定）与每个高峰窗口的起止。
 * 取第一个「判出来的时段和现在不同」的候选点即可——穷举 14 天的候选点（约 70 个）
 * 比逐分钟扫描可靠，也不会漏掉节假日整日空闲这种跨日变化。
 *
 * @param ms - 当前瞬时。
 * @param schedule - {@link normalizeSchedule} 的结果。
 * @returns 下一个切换点的 epoch 毫秒；理论上一定存在，兜底给 24 小时后。
 */
export function nextPeriodChangeAt(ms, schedule) {
  const current = isPeakAt(ms, schedule)
  const today = beijingParts(ms, schedule.offsetMinutes).dateKey
  const candidates = []
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const dateKey = shiftDateKey(today, dayOffset)
    const dayStart = dayStartMs(dateKey, schedule.offsetMinutes)
    candidates.push(dayStart)
    for (const [start, end] of schedule.windows) {
      candidates.push(dayStart + start * 60_000)
      candidates.push(dayStart + end * 60_000)
    }
  }
  const upcoming = candidates.filter((value) => value > ms).sort((left, right) => left - right)
  for (const candidate of upcoming) {
    if (isPeakAt(candidate, schedule) !== current) return candidate
  }
  return ms + 24 * 60 * 60 * 1000
}

/**
 * 把毫秒差写成紧凑倒计时：`62h36m` / `13m20s` / `20s`（小写单位）。
 *
 * 用 H/M/S 而不是「小时/分/秒」：波谷可以一直持续到周一早上，中文单位会写成
 * 「62小时36分」——在那一行里太占宽度，而这一行本来就不宽。秒级只在 60 秒以内出现。
 * @param ms - 正数毫秒差。
 */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

/**
 * 时段的中文/英文名。界面文案只有这一处定义，避免两处写死对不上。
 * @param period - `'peak'` 或 `'offPeak'`。
 * @param language - `'zh'` 或 `'en'`。
 */
export function periodLabel(period, language) {
  const zh = period === 'peak' ? '波峰' : '波谷'
  const en = period === 'peak' ? 'Peak' : 'Off-peak'
  return language === 'en' ? en : zh
}
