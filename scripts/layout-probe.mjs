/** 布局探针：把关键元素的几何量打印进页面，再用 --dump-dom 读出来。 */
import { readFileSync, writeFileSync } from 'node:fs'

const PROBE = [
  '<script>',
  'window.addEventListener("load", function () {',
  '  var lines = [];',
  '  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-chat-running], [data-turn-tail]"));',
  '  rows.forEach(function (row) {',
  '    var r = row.getBoundingClientRect();',
  '    var kind = row.hasAttribute("data-chat-running") ? "running" : "tail";',
  '    lines.push(kind + " row rect=" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " dir=" + getComputedStyle(row).flexDirection + " wrap=" + getComputedStyle(row).flexWrap);',
  '    Array.prototype.slice.call(row.children).forEach(function (child) {',
  '      var c = child.getBoundingClientRect();',
  '      var cs = getComputedStyle(child);',
  '      lines.push("   <" + child.className + "> rect=" + Math.round(c.left) + "," + Math.round(c.top) + " " + Math.round(c.width) + "x" + Math.round(c.height) + " order=" + cs.order + " ml=" + cs.marginLeft + " flex=" + cs.flexGrow + "/" + cs.flexShrink + "/" + cs.flexBasis + " minW=" + cs.minWidth + " of=" + cs.overflow);',
  '    });',
  '  });',
  '  var pre = document.createElement("pre");',
  '  pre.id = "probe";',
  '  pre.textContent = lines.join("\\n");',
  '  document.body.appendChild(pre);',
  '});',
  '<' + '/script>',
].join('\n')

const html = readFileSync(process.argv[2], 'utf8')
writeFileSync(process.argv[3], html.replace('</body>', PROBE + '\n</body>'))
console.log('probe written to', process.argv[3])
