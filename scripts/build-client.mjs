/**
 * 把 `src/client/**` 打成仓根的 `client.js`。
 *
 * 产物必须是 `window.__ModuleLoader__.load({id, factory})` 这个**信封**——DSH 的
 * 客户端模块加载器只认它。信封拼不出来命令行：factory 体是一整段打包结果，要嵌进函数体，
 * 所以这里用 esbuild 的 JS API 拿 `write:false` 的产物字符串自己拼。
 *
 * 硬约束：运行时 `require` 只能出现 seed 表里的 9 个模块。第三方库必须**打进** bundle；
 * 一旦把 `react` 也打进去，运行时 `require('react')` 拿到的是平台那份，两份 React 会以
 * 「hook 只能在函数组件里调用」这类看不懂的方式炸掉。所以 external 精确列这 9 项，
 * 打完逐条核对产物里所有 `require(...)` 的实参，越界即构建失败（不是等运行时）。
 */

import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ENTRY = join(ROOT, 'src', 'client', 'index.jsx')
const OUTFILE = join(ROOT, 'client.js')
const ID = 'dsh-cost-meter'

/** 平台 seed 表。与 DSH 客户端模块加载器的白名单一字不差，多一个都不行。 */
export const SEED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const HEADER = '// Generated from src/client by `pnpm run build` (scripts/build-client.mjs). Do not edit by hand.'

export function wrapEnvelope(factoryBody) {
  // esbuild 的 cjs 产物可能以 "use strict"; 开头。它必须留在函数体第一条语句上，
  // 否则整个 factory 变成非严格模式（模块代码按严格语义写，静默换语义是隐患）。
  const strict = /^"use strict";\n/.test(factoryBody)
  const body = strict ? factoryBody.slice('"use strict";\n'.length) : factoryBody
  return `${HEADER}
window.__ModuleLoader__.load({
  id: '${ID}',
  factory: (require) => {
${strict ? '"use strict";\n' : ''}const module = { exports: {} }
${body}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
`
}

/** 产物里所有 `require(...)` 的实参。非字面量实参也抓出来（它必然是错的）。 */
export function collectRequireArgs(source) {
  const args = []
  const literal = /\brequire\(\s*(["'])((?:(?!\1).)*)\1\s*\)/g
  for (const match of source.matchAll(literal)) args.push(match[2])
  const calls = source.match(/\brequire\s*\(/g) ?? []
  return { args, calls: calls.length }
}

export function assertSeedOnly(source) {
  const { args, calls } = collectRequireArgs(source)
  const outside = [...new Set(args)].filter((id) => !SEED_MODULES.includes(id))
  if (outside.length) throw new Error(`运行时 require 越出 seed 表：${outside.join(', ')}`)
  if (calls !== args.length) throw new Error(`有 ${calls - args.length} 处 require 的实参不是字符串字面量——客户端拿不到动态模块`)
  const envelopes = source.split('window.__ModuleLoader__.load').length - 1
  if (envelopes !== 1) throw new Error(`window.__ModuleLoader__.load 应恰好出现 1 次，实际 ${envelopes} 次`)
  return [...new Set(args)].sort()
}

export async function buildClient({ log = true } = {}) {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: ['es2020'],
    // automatic: JSX → react/jsx-runtime（在 seed 表内）。classic 也行，但 classic
    // 要求每个文件作用域里有 React 标识符，漏一个就是运行时 undefined。
    jsx: 'automatic',
    external: SEED_MODULES,
    charset: 'utf8',
    legalComments: 'none',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
  })

  const factoryBody = result.outputFiles[0].text.trimEnd()
  const output = wrapEnvelope(factoryBody)
  const required = assertSeedOnly(output)
  await writeFile(OUTFILE, output, 'utf8')
  if (log) {
    console.log(`built ${OUTFILE} (${Buffer.byteLength(output, 'utf8')} bytes)`)
    console.log(`require args (${required.length}): ${required.join(', ')}`)
  }
  return { outfile: OUTFILE, output, required }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await buildClient()
  } catch (error) {
    console.error(`[build-client] ${error.message}`)
    process.exit(1)
  }
}
