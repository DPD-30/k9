// Replace module.exports with export default
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Replaces console logging with pino logging',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    let loggerImported = false;
    let needsLoggerImport = false;

    return {
      ImportDeclaration(node) {
        if (node.source.value.includes('/observability/logger.js')) {
          loggerImported = true;
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression') {
          const { object, property } = node.callee;
          const isConsole = (object.type === 'Identifier' && object.name === 'console') ||
                           (object.type === 'MemberExpression' && object.object.name === 'console');

          if (isConsole) {
            const replacementMethod = { log: 'info', info: 'info', warn: 'warn', error: 'error', debug: 'debug' }[property.name];
            if (replacementMethod) {
              needsLoggerImport = true;
              context.report({
                node,
                message: `Replace console.${property.name} with pino logger.`,
                fix(fixer) {
                  const args = node.arguments.map(arg => sourceCode.getText(arg)).join(', ');
                  return fixer.replaceText(node, `logger.${replacementMethod}(${args})`);
                },
              });
            }
          }
        }
      },
      'Program:exit'(node) {
        if (needsLoggerImport && !loggerImported) {
          context.report({
            node,
            message: 'Add import statement for pino logger.',
            fix(fixer) {
              return fixer.insertTextBefore(node, "import { logger } from '../observability/logger.js';\n\n");
            },
          });
        }
      },
    };
  },
};
