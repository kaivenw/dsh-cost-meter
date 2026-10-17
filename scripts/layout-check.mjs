/**
 * 布局自检页：用**真实的**核心 CSS 片段 + 本包真实的 styles.js，在无头浏览器里
 * 把「执行中那一行 / 轮次尾巴 / 兜底槽位」三种落点各渲染一遍并截图。
 *
 * 为什么要这个：插件 CSS 依赖 `:has()` 和父容器原本的 column 布局，改一行就可能
 * 变成换行或挤出边界——而这些只有真的排一次版才看得出来。核心 CSS 是从
 * `dsh-client-ui-chat` / `dsh-client-ui-conversation` 的产物里抄出来的原句
 * （类名换成可读的），窗口宽度、DOM 顺序都做了两种，便于发现「顺序不同就错位」。
 *
 * 用法：node scripts/layout-check.mjs [输出目录]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CSS as PLUGIN_CSS } from '../src/client/styles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] ?? join(ROOT, 'layout-check')

/** 核心 CSS：逐句抄自 dsh-client-ui-chat / dsh-client-ui-conversation 的产物（只换类名）。 */
const CORE_CSS = `
:root{
  --dsh-chat-content-width:1000px;
  --dsh-content-font-size-secondary:13px;
  --dsh-content-font-delta-secondary:0px;
  --dsh-content-font-size:14px;
  --dsh-content-font-delta:0px;
  --dsh-composer-side-clearance:180px;
  --dsh-composer-card-max-width:1440px;
  --dsh-composer-stack-gap:6px;
  --dsh-composer-dock-inset:8px;
  --dsw-alias-label-tertiary:#8a8f98;
  --dsw-alias-label-secondary:#5b6069;
  --dsw-alias-label-primary:#1c1e21;
  --dsw-alias-separator-primary:#d0d3d8;
  --dsw-alias-interactive-bg-hover:#f0f1f3;
  --dsw-alias-label-deep-diving:#3b6ef6;
}
*{box-sizing:border-box}
body{margin:0;font:14px/22px -apple-system,"PingFang SC",system-ui;color:#1c1e21;background:#fff}
.scroll{padding:16px calc(var(--dsh-composer-side-clearance) + 16px)}
.column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex;gap:12px}
.flowItem{min-width:0;color:#5b6069;font-size:13px}

/* ChatView：RunningStatus 那一行 */
.running{--dsh-chat-flow-gap:12px;color:var(--dsw-alias-label-deep-diving);font-size:calc(var(--dsh-content-font-size) - 2px);line-height:calc(22px + var(--dsh-content-font-delta));flex-direction:column;align-items:flex-start;display:flex}
.runningDivider{display:none;background:#e5e7eb;width:100%;height:.5px;margin:8px 0 10px}
.runningContent{align-items:center;gap:6px;min-width:0;display:inline-flex}
.runningText{font-variant-numeric:tabular-nums;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.runningIcon{width:14px;height:14px;flex:none;display:inline-flex}
.visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}

/* TurnTailNodeView：轮次尾巴 */
.tail{flex-direction:column;gap:16px;display:flex}
.tailActions{margin-top:4px;margin-left:-6px;height:28px;align-items:center;gap:8px;display:flex;color:#8a8f98}
.endInfo{min-width:0;color:#8a8f98;align-items:center;gap:8px;margin-left:8px;display:inline-flex}
.action{width:28px;height:28px;border-radius:6px;justify-content:center;align-items:center;display:inline-flex;font-size:14px}
.usage{white-space:nowrap}
.clock{white-space:nowrap}

/* 输入区（composerStack + 输入卡 + dock） */
.composerStack{--dsh-composer-stack-gap:6px;gap:var(--dsh-composer-stack-gap);flex-direction:column;display:flex;padding:0 var(--dsh-composer-side-clearance) 4px}
.card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);margin:0 auto;border:.5px solid #d0d3d8;border-radius:16px;padding:14px 16px;color:#8a8f98}
.deliverable{border:.5px solid #d0d3d8;border-radius:12px;padding:12px 16px;display:flex;gap:12px;align-items:flex-start}
.deliverableIcon{width:32px;height:32px;border-radius:8px;background:#eceefb;display:flex;align-items:center;justify-content:center;flex:none}
.deliverableName{color:#1c1e21;font-size:14px}
.deliverableNote{color:#8a8f98;font-size:13px}
.dock{justify-content:center;align-items:center;gap:12px;max-width:100%;padding-top:4px;display:flex}
`

/** 三个 pill，与 pills.jsx 渲染出来的结构一致。 */
function pills() {
  return `
      <button class="dcm_pill">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1"><circle cx="8" cy="8" r="6"/></svg>
        <span class="dcm_label">本轮 ≈¥0.3516<span class="dcm_sep dcm_session">·</span><span class="dcm_session">会话 ¥6.10</span></span>
      </button>
      <span class="dcm_pill" data-cost-secondary data-cost-period>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1"><circle cx="8" cy="8" r="6"/></svg>
        <span class="dcm_label">波峰<span class="dcm_sep">·</span><span class="dcm_optional">1小时57分</span></span>
      </span>
      <span class="dcm_pill" data-cost-secondary data-cost-balance>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="4.6" width="12" height="6.8" rx="2"/></svg>
        <span class="dcm_label">余额 ¥93.07</span>
      </span>`
}

/** 一份页面：mounted 决定本插件条目在 DOM 里排前还是排后。 */
function page({ width, first }) {
  const mine = (placement) => `<div class="dcm_root" data-cost-meter data-placement="${placement}">${pills()}</div>`
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>cost-meter layout ${width}${first ? ' (mine first)' : ''}</title>
<style>${CORE_CSS}${PLUGIN_CSS}</style></head><body>
<div class="scroll">
  <div class="column" data-chat-flow>
    <div class="flowItem">读取 · ~/IdeaProjects/dsh-cost-meter/README.md</div>
    <div class="flowItem">编辑 · 正在准备内容 1KB</div>
    <div class="running" data-chat-running>
      <span class="visuallyHidden" role="status">深度求索中</span>
      <span class="runningDivider" aria-hidden="true"></span>
      <span class="runningContent"><span class="runningIcon">🐳</span><span class="runningText">深度求索中，用时 1分55秒 ···</span></span>
      ${first ? mine('running') : ''}${first ? '' : mine('running')}
    </div>
    <div class="tail" data-turn-tail="6">
      <div class="deliverable">
        <div class="deliverableIcon">🖼</div>
        <div><div class="deliverableName">layout-1600.png</div><div class="deliverableNote">无头浏览器渲染的布局自检：执行中那一行（文字在左、本插件在右）、轮次尾巴、兜底槽位</div></div>
      </div>
      ${first ? mine('tail') : ''}
      <div class="tailActions">
        <span class="action">⧉</span><span class="action">👍</span><span class="action">👎</span><span class="action">↗</span>
        <span class="endInfo"><span class="usage">用量 3.8M tok</span><span class="clock">16:04</span></span>
      </div>
      ${first ? '' : mine('tail')}
    </div>
  </div>
</div>
<div class="composerStack">
  <div class="dock">${mine('dock')}</div>
  <div class="card">发消息或创建任务，/ 调用指令，@ 文件或对话</div>
</div>
</body></html>`
}

/** 找一个无头浏览器：可用 BROWSER_BIN 覆盖；macOS / Windows / Linux 各试常见路径。 */
function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'linux' ? '/usr/bin/microsoft-edge' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`没找到无头浏览器；用 BROWSER_BIN=<可执行文件路径> 指定。试过：${candidates.join(' / ')}`)
}


function shoot(file, png, width) {
  execFileSync(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${png}`, `--window-size=${width},560`, pathToFileURL(file).href,
  ], { stdio: 'ignore' })
}

mkdirSync(OUT, { recursive: true })
for (const width of [1810, 1400, 1200, 1000, 862]) {
  for (const first of [false, true]) {
    const name = `layout-${width}${first ? '-minefirst' : ''}`
    const file = join(OUT, `${name}.html`)
    writeFileSync(file, page({ width, first }), 'utf8')
    shoot(file, join(OUT, `${name}.png`), width)
    console.log(`wrote ${join(OUT, `${name}.png`)}`)
  }
}
