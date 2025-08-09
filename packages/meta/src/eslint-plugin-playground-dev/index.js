const wpBuildsDepRule = require('./avoid-wordpress-builds-dependency');
const noStaticAssetImports = require('./no-static-asset-imports');
const plugin = {
	rules: {
		'avoid-wordpress-builds-dependency': wpBuildsDepRule,
		'no-static-asset-imports': noStaticAssetImports,
	},
};
module.exports = plugin;
