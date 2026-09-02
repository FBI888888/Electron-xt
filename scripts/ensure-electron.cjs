// Electron 43+ 不再走 npm install 生命周期下载二进制；
// npm 11 也会忽略 .npmrc 的 electron_mirror。这里显式用国内镜像补齐。
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||=
  'https://npmmirror.com/mirrors/electron-builder-binaries/'

const { spawnSync } = require('child_process')
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit',
  env: process.env
})

process.exit(result.status ?? 1)
