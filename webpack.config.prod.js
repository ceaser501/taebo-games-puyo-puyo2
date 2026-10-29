const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = merge(common, {
  mode: 'production',
  // Pictures and sounds are big on purpose; size hints would only be noise.
  performance: { hints: false },
  plugins: [
    new CopyPlugin({
      patterns: [
        // Site-wide: the root page (forwards to puyo/) and shared icons.
        { from: 'index.html', to: 'index.html' },
        { from: 'robots.txt', to: 'robots.txt' },
        { from: 'icon.png', to: 'icon.png' },
        { from: 'icon.svg', to: 'icon.svg' },
        { from: '404.html', to: '404.html' },
        { from: 'site.webmanifest', to: 'site.webmanifest' },
        { from: 'icon-512.png', to: 'icon-512.png' },
        { from: 'icon-maskable-512.png', to: 'icon-maskable-512.png' },
        // Installing as an app needs a service worker (sw.js passes everything through).
        { from: 'sw.js', to: 'sw.js' },
        // Puyo Puyo 2
        { from: 'puyo/index.html', to: 'puyo/index.html' },
        { from: 'puyo/css', to: 'puyo/css' },
        { from: 'puyo/assets', to: 'puyo/assets', noErrorOnMissing: true },
      ],
    }),
  ],
});
