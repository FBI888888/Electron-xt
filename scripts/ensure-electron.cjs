// Electron 43+ 不再走 npm install 生命周期下载二进制；
// npm 11 也会忽略 .npmrc 的 electron_mirror。这里显式用国内镜像补齐。
// @electron/get 已是 ESM，install.js 在 Node 18 上 require 会直接失败。
const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`Electron 43 需要 Node 20+，当前为 ${process.version}`)
  process.exit(1)
}

process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||=
  'https://npmmirror.com/mirrors/electron-builder-binaries/'

const { spawnSync } = require('child_process')
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit',
  env: process.env
})

process.exit(result.status ?? 1)
