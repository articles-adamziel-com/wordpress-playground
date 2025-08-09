module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow importing binary assets (.wasm/.dat/.bin) from packages',
			recommended: false,
		},
		schema: [],
	},
	create(context) {
		function reportIfBinary(value, node) {
			if (typeof value === 'string' && /\.(wasm|dat|bin)$/.test(value)) {
				context.report({
					node,
					message:
						'Do not import binary assets (.wasm/.dat/.bin); use @php-wasm/assets instead.',
				});
			}
		}
		return {
			ImportDeclaration(node) {
				reportIfBinary(node.source.value, node);
			},
			CallExpression(node) {
				if (
					node.callee.type === 'Import' &&
					node.arguments.length &&
					node.arguments[0].type === 'Literal'
				) {
					reportIfBinary(node.arguments[0].value, node);
				}
			},
		};
	},
};
