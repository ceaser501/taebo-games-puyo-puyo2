const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    liveReload: true,
    hot: true,
    open: true,
    static: {
      directory: './',
      // IDE files and generated output change constantly and would trigger endless reloads.
      watch: { ignored: /(node_modules|\.idea|\.git|\.vscode|dist|assets|\.DS_Store)/ },
    },
  },
});
