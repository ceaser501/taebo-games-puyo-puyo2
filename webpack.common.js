const path = require('path');
const { execSync } = require('child_process');
const webpack = require('webpack');

// Shown at the bottom of the menu, so a deployed page tells which code it runs.
let build = 'dev';
try { build = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }

// The bundle lands in puyo/js/app.js, next to the page that loads it.
module.exports = {
  entry: {
    puyo: './puyo/js/app.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: '[name]/js/app.js',
    chunkFilename: 'puyo/js/chunk-[id].js',
  },
  plugins: [new webpack.DefinePlugin({ BUILD_ID: JSON.stringify(build) })],
};
