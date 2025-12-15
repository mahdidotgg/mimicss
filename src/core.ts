import { parse, type ParserOptions } from '@babel/parser'
import type { TraverseOptions } from '@babel/traverse'
import type * as BabelTypes from '@babel/types'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import MagicString from 'magic-string'

import _traverse from '@babel/traverse'

type TraverseFn = (ast: BabelTypes.Node, opts: TraverseOptions) => void

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: TraverseFn }).default

const BASE54 = 'etnrisouacldhmpgfbwyvkxjqzETNRISOUACLDHMPGFBWYVKXJQZ'.split('')

const PARSER_OPTIONS: ParserOptions = {
  sourceType: 'unambiguous',
  plugins: ['jsx'],
  errorRecovery: true,
}

export interface ClassMinifierOptions {
  exclude?: RegExp[]
}

class NameGenerator {
  private chars: string[]
  private readonly frequency: Map<string, number>

  constructor() {
    this.chars = [...BASE54]
    this.frequency = new Map()
  }

  reset(): void {
    this.frequency.clear()
    for (const ch of BASE54) {
      this.frequency.set(ch, 0)
    }
  }

  recordUsage(str: string, weight = 1): void {
    for (const ch of str) {
      const current = this.frequency.get(ch)
      if (current !== undefined) {
        this.frequency.set(ch, current + weight)
      }
    }
  }

  sortByFrequency(): void {
    this.chars = [...BASE54].sort(
      (a, b) => (this.frequency.get(b) ?? 0) - (this.frequency.get(a) ?? 0),
    )
  }

  generate(index: number): string {
    const base = this.chars.length
    let result = ''
    let n = index

    do {
      result = this.chars[n % base] + result
      n = Math.floor(n / base) - 1
    } while (n >= 0)

    return result
  }
}

export class ClassMinifier {
  private currentIndex = 0
  private readonly classMap = new Map<string, string>()
  private readonly excludePatterns: RegExp[]
  private readonly nameGenerator: NameGenerator
  private readonly classUsageCount = new Map<string, number>()
  private readonly dynamicPrefixes = new Set<string>()

  constructor(options: ClassMinifierOptions = {}) {
    this.excludePatterns = options.exclude ?? []
    this.nameGenerator = new NameGenerator()
  }

  private isExcluded(className: string): boolean {
    if (this.excludePatterns.some((pattern) => pattern.test(className))) return true
    for (const prefix of this.dynamicPrefixes) {
      if (className.startsWith(prefix)) return true
    }
    return false
  }

  private getNextName(): string {
    for (;;) {
      const name = this.nameGenerator.generate(this.currentIndex++)
      if (!this.isExcluded(name)) {
        return name
      }
    }
  }

  analyzeJS(code: string): void {
    const ast = parse(code, PARSER_OPTIONS)
    const classUsage = this.classUsageCount
    const dynamicPrefixes = this.dynamicPrefixes

    const countClasses = (str: string): void => {
      const classes = str
        .trim()
        .split(/\s+/)
        .filter((c) => c.length > 0)
      for (const className of classes) {
        const currentCount = classUsage.get(className) ?? 0
        classUsage.set(className, currentCount + 1)
      }
    }

    const detectPrefixes = (str: string): void => {
      const tokens = str
        .trim()
        .split(/\s+/)
        .filter((c) => c.length > 0)
      for (const token of tokens) {
        if (token.endsWith('-') || token.endsWith(':')) {
          dynamicPrefixes.add(token)
        }
      }
    }

    traverse(ast, {
      StringLiteral(path) {
        countClasses(path.node.value)
      },
      TemplateLiteral(path) {
        const quasis = path.node.quasis
        for (let i = 0; i < quasis.length; i++) {
          const cooked = quasis[i].value.cooked
          if (cooked) {
            countClasses(cooked)
            if (i < quasis.length - 1) {
              detectPrefixes(cooked)
            }
          }
        }
      },
    })
  }

  extractFromCSS(css: string): void {
    this.nameGenerator.reset()
    const cssClasses = new Set<string>()

    const root = postcss.parse(css)
    root.walkRules((rule) => {
      selectorParser((selectors) => {
        selectors.walkClasses((node) => {
          this.nameGenerator.recordUsage(node.value)
          cssClasses.add(node.value)
        })
      }).processSync(rule.selector)
    })

    this.nameGenerator.sortByFrequency()

    const sortedClasses = [...cssClasses].sort(
      (a, b) => (this.classUsageCount.get(b) ?? 0) - (this.classUsageCount.get(a) ?? 0),
    )

    for (const className of sortedClasses) {
      if (this.isExcluded(className)) {
        this.classMap.set(className, className)
      } else {
        this.classMap.set(className, this.getNextName())
      }
    }
  }

  transformCSS(css: string): string {
    const root = postcss.parse(css)

    root.walkRules((rule) => {
      rule.selector = selectorParser((selectors) => {
        selectors.walkClasses((node) => {
          if (this.isExcluded(node.value)) return

          const minified = this.classMap.get(node.value)
          if (minified) {
            node.value = minified
          }
        })
      }).processSync(rule.selector)
    })

    return root.toString()
  }

  transformJS(code: string): string {
    const ast = parse(code, PARSER_OPTIONS)
    const magicString = new MagicString(code)
    const classMap = this.classMap

    const isTransformable = (str: string): boolean => {
      const trimmed = str.trim()
      if (!trimmed) return false
      const classes = trimmed.split(/\s+/)
      return classes.length > 0 && classes.some((c) => classMap.has(c))
    }

    const transformClassList = (
      str: string,
      addLeadingSpace = false,
      addTrailingSpace = false,
    ): string => {
      const leadingSpace = addLeadingSpace ? ' ' : ''
      const classes = str
        .trim()
        .split(/\s+/)
        .filter((c) => c.length > 0)
      const lastClass = classes.at(-1)
      const endsWithPartial =
        lastClass !== undefined && (lastClass.endsWith('-') || lastClass.endsWith(':'))
      const trailingSpace = addTrailingSpace && !endsWithPartial ? ' ' : ''
      return leadingSpace + classes.map((c) => classMap.get(c) ?? c).join(' ') + trailingSpace
    }

    const checkPartialTransform = (
      str: string,
    ): { canTransform: boolean; partialSuffix: string } => {
      const trimmed = str.trim()
      if (!trimmed) return { canTransform: false, partialSuffix: '' }

      const parts = trimmed.split(/\s+/).filter((p) => p.length > 0)
      if (parts.length === 0) return { canTransform: false, partialSuffix: '' }

      const lastPart = parts[parts.length - 1]
      if (!lastPart) return { canTransform: false, partialSuffix: '' }

      if (lastPart.endsWith('-') || lastPart.endsWith(':')) {
        const completeClasses = parts.slice(0, -1)
        if (completeClasses.length > 0 && completeClasses.every((c) => classMap.has(c))) {
          return { canTransform: true, partialSuffix: lastPart }
        }
      }

      return { canTransform: false, partialSuffix: '' }
    }

    const transformPartial = (
      str: string,
      partialSuffix: string,
      preserveLeadingWhitespace = false,
    ): string => {
      const leadingSpace = preserveLeadingWhitespace && str.startsWith(' ') ? ' ' : ''
      const beforePartial = str.trim().slice(0, -partialSuffix.length).trim()
      const classes = beforePartial.split(/\s+/).filter((c) => c.length > 0)
      const transformed = classes.map((c) => classMap.get(c) ?? c).join(' ')
      return `${leadingSpace}${transformed} ${partialSuffix}`
    }

    const escapeTemplateRaw = (str: string): string => {
      return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
    }

    const escapeStringLiteral = (str: string, quote: string): string => {
      let escaped = str.replace(/\\/g, '\\\\')
      if (quote === '"') {
        escaped = escaped.replace(/"/g, '\\"')
      } else if (quote === "'") {
        escaped = escaped.replace(/'/g, "\\'")
      }
      return escaped
    }

    const isInsideStyleProp = (path: { parentPath?: unknown }): boolean => {
      let current = path.parentPath as
        | { node?: { type?: string; key?: { type?: string; name?: string } }; parentPath?: unknown }
        | undefined
      while (current) {
        const node = current.node
        if (node?.type === 'ObjectProperty') {
          const key = node.key
          if (key?.type === 'Identifier' && key.name === 'style') {
            return true
          }
        }
        current = current.parentPath as typeof current
      }
      return false
    }

    const isInConcatenation = (path: {
      parent: unknown
      node: unknown
    }): { before: boolean; after: boolean } => {
      const parent = path.parent as {
        type?: string
        operator?: string
        left?: unknown
        right?: unknown
      } | null
      if (parent?.type !== 'BinaryExpression' || parent.operator !== '+') {
        return { before: false, after: false }
      }
      const isLeftSide = parent.left === path.node
      const isRightSide = parent.right === path.node
      return { before: isRightSide, after: isLeftSide }
    }

    traverse(ast, {
      StringLiteral(path) {
        const node = path.node
        if (node.start == null || node.end == null) return

        if (isInsideStyleProp(path)) return

        if (isTransformable(node.value)) {
          const concat = isInConcatenation(path as { parent: unknown; node: unknown })
          const transformed = transformClassList(node.value, concat.before, concat.after)
          const originalQuote = code.charAt(node.start)
          const escaped = escapeStringLiteral(transformed, originalQuote)
          magicString.overwrite(node.start, node.end, `${originalQuote}${escaped}${originalQuote}`)
        }
      },
      TemplateLiteral(path) {
        const quasis = path.node.quasis
        quasis.forEach((quasi, index) => {
          if (quasi.start == null || quasi.end == null) return
          const cooked = quasi.value.cooked
          if (!cooked) return

          const hasExpressionBefore = index > 0
          const hasExpressionAfter = index < quasis.length - 1

          if (isTransformable(cooked)) {
            const transformed = transformClassList(cooked, hasExpressionBefore, hasExpressionAfter)
            const raw = escapeTemplateRaw(transformed)
            magicString.overwrite(quasi.start, quasi.end, raw)
          } else if (hasExpressionAfter) {
            const { canTransform, partialSuffix } = checkPartialTransform(cooked)
            if (canTransform) {
              const transformed = transformPartial(cooked, partialSuffix, hasExpressionBefore)
              const raw = escapeTemplateRaw(transformed)
              magicString.overwrite(quasi.start, quasi.end, raw)
            }
          }
        })
      },
    })

    return magicString.toString()
  }

  getMapping(): Record<string, string> {
    return Object.fromEntries(this.classMap)
  }

  getClassCount(): number {
    return this.classMap.size
  }
}
