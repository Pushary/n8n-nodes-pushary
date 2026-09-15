// Copies node icons (svg/png) into dist next to their compiled .js, since tsc
// only emits JavaScript. n8n loads the icon from the path in the node's
// `icon: 'file:pushary.svg'` field, resolved relative to the compiled node.
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'nodes')
const OUT = path.join(__dirname, 'dist', 'nodes')

function copyIcons(dir, outDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name)
    const to = path.join(outDir, entry.name)
    if (entry.isDirectory()) {
      copyIcons(from, to)
    } else if (/\.(svg|png)$/.test(entry.name)) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.copyFileSync(from, to)
      console.log(`copied ${path.relative(__dirname, to)}`)
    }
  }
}

copyIcons(SRC, OUT)
