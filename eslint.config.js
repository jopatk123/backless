import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

/**
 * 工作区行数预算规则（见 AGENTS.md）：
 * - 有效行数 > 600：本插件触发警告，提示拆分文件
 * - 有效行数 > 800：下方内置 max-lines 规则直接报错（阻断 CI）
 */
const lineBudget = {
  plugins: {
    backless: {
      rules: {
        'warn-over-600-lines': {
          meta: {
            type: 'suggestion',
            schema: [],
            messages: {
              over: '文件有效行数 {{count}} 超过 600，建议拆分模块（超过 800 将阻断 CI）',
            },
          },
          create(context) {
            return {
              Program(node) {
                const lines = context.sourceCode.getLines()
                const effective = lines.filter((line) => line.trim().length > 0).length
                if (effective > 600) {
                  context.report({ node, messageId: 'over', data: { count: effective } })
                }
              },
            }
          },
        },
      },
    },
  },
  rules: {
    'backless/warn-over-600-lines': 'warn',
  },
}

export default [
  {
    ignores: ['dist/', 'node_modules/', 'pic/', 'coverage/'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  skipFormatting,
  lineBudget,
  {
    rules: {
      // 硬性上限：有效行数 > 800 直接报错，阻断 CI
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      // 组件名来自文件名（script setup），此规则对本项目无意义
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['src/**'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['scripts/**', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
