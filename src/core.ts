import { parse, type ParserOptions } from '@babel/parser'
import type { TraverseOptions } from '@babel/traverse'
import type { GeneratorOptions } from '@babel/generator'
import type * as BabelTypes from '@babel/types'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'


import _traverse from '@babel/traverse'
import _generate from '@babel/generator'

type TraverseFn = (ast: BabelTypes.Node, opts: TraverseOptions) => void

type GenerateFn = (ast: BabelTypes.Node, opts?: GeneratorOptions) => { code: string }

const traverse: TraverseFn =
  typeof _traverse === 'function'
    ? _traverse
    : (_traverse as unknown as { default: TraverseFn }).default

const generate: GenerateFn =
  typeof _generate === 'function'
    ? _generate
    : (_generate as unknown as { default: GenerateFn }).default

/** Characters that can start a CSS class name (a-z, A-Z, underscore = 53 chars) */
const LEADING_CHARS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '_',
]

/** Characters that can only appear after the first character (digits, hyphen = 11 chars) */
const FOLLOWING_ONLY_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-']

/** All 64 valid CSS class name characters */
const ALL_CHARS = [...LEADING_CHARS, ...FOLLOWING_ONLY_CHARS]

/** Babel parser configuration for analyzing JS/JSX code */
const PARSER_OPTIONS: ParserOptions = {
  sourceType: 'unambiguous',
  plugins: ['jsx'],
  errorRecovery: true,
}

/**
 * Configuration options for the ClassMinifier
 */
export interface ClassMinifierOptions {
  /** Regular expressions for class names to exclude from minification */
  exclude?: RegExp[]
}

/**
 * Generates short identifiers using a frequency-optimized character set.
 * Similar to terser
 */
class NameGenerator {
  private leadingChars: string[]
  private allChars: string[]
  private readonly frequency: Map<string, number>

  constructor() {
    this.leadingChars = [...LEADING_CHARS]
    this.allChars = [...ALL_CHARS]
    this.frequency = new Map()
    this.reset()
  }

  /** Reset frequency counts to zero */
  reset(): void {
    this.frequency.clear()
    for (const ch of ALL_CHARS) {
      this.frequency.set(ch, 0)
    }
  }

  /** Record character usage */
  recordUsage(str: string, weight = 1): void {
    for (const ch of str) {
      const current = this.frequency.get(ch)
      if (current !== undefined) {
        this.frequency.set(ch, current + weight)
      }
    }
  }

  /** Sort character sets by frequency */
  sortByFrequency(): void {
    const compare = (a: string, b: string): number =>
      (this.frequency.get(b) ?? 0) - (this.frequency.get(a) ?? 0)

    this.leadingChars = [...LEADING_CHARS].sort(compare)
    this.allChars = [...ALL_CHARS].sort(compare)
  }

  /** Generate for the given index */
  generate(index: number): string {
    let result = ''
    let base = this.leadingChars.length
    let num = index + 1

    do {
      num--
      if (result.length === 0) {
        result = this.leadingChars[num % base] ?? ''
      } else {
        result += this.allChars[num % this.allChars.length] ?? ''
      }
      num = Math.floor(num / base)
      base = this.allChars.length
    } while (num > 0)

    return result
  }
}

/**
 * Minifies CSS class names by replacing them with shorter versions.
 */
export class ClassMinifier {
  private currentIndex = 0
  private readonly classMap = new Map<string, string>()
  private readonly excludePatterns: RegExp[]
  private readonly nameGenerator: NameGenerator
  private readonly classUsageCount = new Map<string, number>()

  constructor(options: ClassMinifierOptions = {}) {
    this.excludePatterns = options.exclude ?? []
    this.nameGenerator = new NameGenerator()
  }

  /** Check if a class name matches any exclude pattern */
  private isExcluded(className: string): boolean {
    return this.excludePatterns.some((pattern) => pattern.test(className))
  }

  /** Generate the next available short name, skipping excluded patterns */
  private getNextName(): string {
    // Loop until we find a non-excluded name
    for (;;) {
      const name = this.nameGenerator.generate(this.currentIndex++)
      if (!this.isExcluded(name)) {
        return name
      }
    }
  }

  /**
   * Analyze JavaScript code to count class name usage.
   * Call this before extractFromCSS to optimize name assignment.
   */
  analyzeJS(code: string): void {
    const ast = parse(code, PARSER_OPTIONS)
    const classUsage = this.classUsageCount

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

    traverse(ast, {
      StringLiteral(path) {
        countClasses(path.node.value)
      },
      TemplateLiteral(path) {
        for (const quasi of path.node.quasis) {
          if (quasi.value.cooked) {
            countClasses(quasi.value.cooked)
          }
        }
      },
    })
  }

  /**
   * Extract class names from CSS and build mapping.
   */
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

    // Sort classes by JS usage frequency (most used first)
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

  /** Transform CSS by replacing class names with their minified versions */
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

  /** Transform JavaScript by replacing classname strings */
  transformJS(code: string): string {
    const ast = parse(code, PARSER_OPTIONS)
    const classMap = this.classMap

    const isValidClassList = (str: string): boolean => {
      const trimmed = str.trim()
      if (!trimmed) return false

      const classes = trimmed.split(/\s+/).filter((c) => c.length > 0)
      if (classes.length === 0) return false

      return classes.every((c) => classMap.has(c))
    }

    const transformClassList = (str: string): string => {
      const leadingWhitespace = /^\s*/.exec(str)?.[0] ?? ''
      const trailingWhitespace = /\s*$/.exec(str)?.[0] ?? ''
      const classes = str
        .trim()
        .split(/\s+/)
        .filter((c) => c.length > 0)
      const transformed = classes.map((c) => classMap.get(c) ?? c).join(' ')
      return leadingWhitespace + transformed + trailingWhitespace
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

      // Check for partial class prefixes
      if (lastPart.endsWith('-') || lastPart.endsWith(':')) {
        const completeClasses = parts.slice(0, -1)
        if (completeClasses.length > 0 && completeClasses.every((c) => classMap.has(c))) {
          return { canTransform: true, partialSuffix: lastPart }
        }
      }

      return { canTransform: false, partialSuffix: '' }
    }

    const transformPartial = (str: string, partialSuffix: string): string => {
      const leadingWhitespace = /^\s*/.exec(str)?.[0] ?? ''
      const beforePartial = str.trimStart().slice(0, -partialSuffix.length).trim()
      const classes = beforePartial.split(/\s+/).filter((c) => c.length > 0)
      const transformed = classes.map((c) => classMap.get(c) ?? c).join(' ')
      return `${leadingWhitespace}${transformed} ${partialSuffix}`
    }

    const escapeTemplateRaw = (str: string): string => {
      return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')
    }

    traverse(ast, {
      StringLiteral(path) {
        if (isValidClassList(path.node.value)) {
          path.node.value = transformClassList(path.node.value)
        }
      },
      TemplateLiteral(path) {
        const quasis = path.node.quasis
        quasis.forEach((quasi, index) => {
          const cooked = quasi.value.cooked
          if (!cooked) return

          if (isValidClassList(cooked)) {
            const transformed = transformClassList(cooked)
            quasi.value.cooked = transformed
            quasi.value.raw = escapeTemplateRaw(transformed)
          } else if (index < quasis.length - 1) {
            const { canTransform, partialSuffix } = checkPartialTransform(cooked)
            if (canTransform) {
              const transformed = transformPartial(cooked, partialSuffix)
              quasi.value.cooked = transformed
              quasi.value.raw = escapeTemplateRaw(transformed)
            }
          }
        })
      },
    })

    return generate(ast, { compact: true, minified: true }).code
  }

  /** Get the complete class name mapping */
  getMapping(): Record<string, string> {
    return Object.fromEntries(this.classMap)
  }

  /** Get the total number of mapped classes */
  getClassCount(): number {
    return this.classMap.size
  }
}
