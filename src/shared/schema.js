/**
 * 极小的结构校验器，只为满足会话投影注册表的 `stateSchema.parse(view)` 约定。
 *
 * 为什么自己写而不引 zod：宿主插件运行在 DSH 进程里，裸模块解析不到 zod
 * （插件目录下没有它，profile 的 node_modules 也没有），引它就要在 profile 里
 * 多装一个运行时依赖。投影注册表对 schema 只要求一个 `parse(value)`：
 *   dsh-session-projection/lib/index.js → def.stateSchema.parse(row.val) / wire.viewSchema.parse(...)
 * 所以这里实现一个同形状的 `parse`，行为按 zod 的 `.strict()` 语义：
 *   对象多字段即错、类型不对即错、错误信息带路径。
 *
 * 校验失败抛错是**刻意**的：检查点缓存里的一行坏数据必须炸在恢复处，
 * 而不是让后续把坏状态当正常状态用。
 */

function fail(path, message, value) {
  const where = path === '' ? '<根>' : path
  throw new Error(`cost-meter schema: ${where} ${message}（实际 ${describe(value)}）`)
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `数组(${value.length})`
  if (typeof value === 'object') return `对象{${Object.keys(value).slice(0, 6).join(',')}}`
  if (typeof value === 'string') return `字符串(${value.length > 24 ? `${value.slice(0, 24)}…` : value})`
  return String(value)
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function check(spec, value, path) {
  return spec.parse(value, path)
}

/** 任意值（用于配置里透传的字段）。 */
export function any() {
  return { parse: (value) => value }
}

/** 字符串。 */
export function str() {
  return { parse: (value, path = '') => {
    if (typeof value !== 'string') fail(path, '应为字符串', value)
    return value
  } }
}

/** 布尔。 */
export function bool() {
  return { parse: (value, path = '') => {
    if (typeof value !== 'boolean') fail(path, '应为布尔', value)
    return value
  } }
}

/** 有限数字。 */
export function num() {
  return { parse: (value, path = '') => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '应为有限数字', value)
    return value
  } }
}

/** 非负整数。 */
export function int() {
  return { parse: (value, path = '') => {
    if (!Number.isSafeInteger(value) || value < 0) fail(path, '应为非负安全整数', value)
    return value
  } }
}

/** 固定字面量。 */
export function literal(expected) {
  return { parse: (value, path = '') => {
    if (value !== expected) fail(path, `应为 ${JSON.stringify(expected)}`, value)
    return value
  } }
}

/** 可为 null。 */
export function nullable(spec) {
  return { parse: (value, path = '') => (value === null ? null : check(spec, value, path)) }
}

/** 对象；默认 strict（多字段即错），与 zod 的 `.strict()` 一致。 */
export function object(shape) {
  const keys = Object.keys(shape)
  return { parse: (value, path = '') => {
    if (!isPlainObject(value)) fail(path, '应为对象', value)
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(path === '' ? key : `${path}.${key}`, '是未声明字段', value[key])
    }
    const output = {}
    for (const key of keys) {
      const child = path === '' ? key : `${path}.${key}`
      if (value[key] === undefined) fail(child, '缺失', value[key])
      output[key] = check(shape[key], value[key], child)
    }
    return output
  } }
}

/** 数组。 */
export function array(item) {
  return { parse: (value, path = '') => {
    if (!Array.isArray(value)) fail(path, '应为数组', value)
    return value.map((entry, index) => check(item, entry, `${path}[${index}]`))
  } }
}

/** 字符串键的字典。 */
export function record(valueSpec) {
  return { parse: (value, path = '') => {
    if (!isPlainObject(value)) fail(path, '应为对象字典', value)
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      output[key] = check(valueSpec, entry, path === '' ? key : `${path}.${key}`)
    }
    return output
  } }
}

/** 联合：按顺序试，全失败报第一个错。 */
export function union(specs) {
  return { parse: (value, path = '') => {
    let firstError
    for (const spec of specs) {
      try {
        return check(spec, value, path)
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
    }
    throw firstError
  } }
}
