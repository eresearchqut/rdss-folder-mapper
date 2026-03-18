const globals = require('globals');

const customConfig = [];
let hasIgnoresFile = false;
try {
  require.resolve('./eslint.ignores.js');
  hasIgnoresFile = true;
} catch {
  // eslint.ignores.js doesn't exist
}

if (hasIgnoresFile) {
  const ignores = require('./eslint.ignores.js');
  customConfig.push({ ignores });
}

customConfig.push({
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.jest,
    },
  },
});

module.exports = [...customConfig, ...require('gts')];
