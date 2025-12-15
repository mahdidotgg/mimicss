import { describe, it, expect } from 'vitest'
import { ClassMinifier } from '../src/core'

describe('ClassMinifier', () => {
  describe('basic functionality', () => {
    it('should generate single-character class names', () => {
      const minifier = new ClassMinifier()
      const css = '.flex { display: flex; } .block { display: block; }'
      minifier.extractFromCSS(css)

      const mapping = minifier.getMapping()
      expect(Object.keys(mapping)).toHaveLength(2)
      expect(mapping['flex']).toHaveLength(1)
      expect(mapping['block']).toHaveLength(1)
    })

    it('should transform CSS class selectors', () => {
      const minifier = new ClassMinifier()
      const css = '.flex { display: flex; }'
      minifier.extractFromCSS(css)

      const result = minifier.transformCSS(css)
      const mapping = minifier.getMapping()
      expect(result).toContain(`.${mapping['flex']}`)
      expect(result).not.toContain('.flex')
    })

    it('should transform JS string literals', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { display: flex; }')

      const js = 'const x = "flex"'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()
      expect(result).toContain(`"${mapping['flex']}"`)
    })

    it('should transform multiple classes in a string', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .items-center { } .gap-2 { }')

      const js = 'const x = "flex items-center gap-2"'
      const result = minifier.transformJS(js)
      expect(result).not.toContain('flex')
      expect(result).not.toContain('items-center')
      expect(result).not.toContain('gap-2')
    })

    it('should handle template literals', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .hidden { }')

      const js = 'const x = `flex hidden`'
      const result = minifier.transformJS(js)
      expect(result).not.toContain('flex')
      expect(result).not.toContain('hidden')
    })

    it('should collapse whitespace in transformed strings', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .block { }')

      const js = 'const x = "flex    block"'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()
      expect(result).toContain(`"${mapping['flex']} ${mapping['block']}"`)
    })

    it('should collapse newlines in transformed strings', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.a { } .b { } .c { }')

      const js = 'const x = `a\n  b\n  c`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()
      expect(result).toContain(`\`${mapping['a']} ${mapping['b']} ${mapping['c']}\``)
    })
  })

  describe('exclude patterns', () => {
    it('should not minify excluded classes', () => {
      const minifier = new ClassMinifier({ exclude: [/^fi$/, /^fi-/] })
      minifier.extractFromCSS('.fi { } .fi-home { } .flex { }')

      const mapping = minifier.getMapping()
      expect(mapping['fi']).toBe('fi')
      expect(mapping['fi-home']).toBe('fi-home')
      expect(mapping['flex']).not.toBe('flex')
    })

    it('should skip generated names that match exclude patterns', () => {
      const minifier = new ClassMinifier({ exclude: [/^a$/] })
      minifier.extractFromCSS('.flex { } .block { }')

      const mapping = minifier.getMapping()
      const values = Object.values(mapping)
      expect(values).not.toContain('a')
    })
  })

  describe('frequency-based optimization', () => {
    it('should assign shorter names to more frequently used classes', () => {
      const minifier = new ClassMinifier()

      // Analyze JS first
      const js = `
        const a = "flex flex flex flex flex flex flex flex flex flex"
        const b = "block"
      `
      minifier.analyzeJS(js)
      minifier.extractFromCSS('.flex { } .block { }')

      const mapping = minifier.getMapping()
      // flex should get a shorter name
      expect(mapping['flex'].length).toBeLessThanOrEqual(mapping['block'].length)
    })
  })

  describe('CSS selector handling', () => {
    it('should handle compound selectors', () => {
      const minifier = new ClassMinifier()
      const css = '.flex.items-center { }'
      minifier.extractFromCSS(css)

      const result = minifier.transformCSS(css)
      const mapping = minifier.getMapping()
      expect(result).toContain(`.${mapping['flex']}.${mapping['items-center']}`)
    })

    it('should handle descendant selectors', () => {
      const minifier = new ClassMinifier()
      const css = '.container .item { }'
      minifier.extractFromCSS(css)

      const result = minifier.transformCSS(css)
      const mapping = minifier.getMapping()
      expect(result).toContain(`.${mapping['container']} .${mapping['item']}`)
    })

    it('should handle pseudo-classes', () => {
      const minifier = new ClassMinifier()
      const css = '.btn:hover { }'
      minifier.extractFromCSS(css)

      const result = minifier.transformCSS(css)
      const mapping = minifier.getMapping()
      expect(result).toContain(`.${mapping['btn']}:hover`)
    })

    it('should handle media queries', () => {
      const minifier = new ClassMinifier()
      const css = '@media (min-width: 768px) { .flex { } }'
      minifier.extractFromCSS(css)

      const result = minifier.transformCSS(css)
      expect(result).toContain('@media')
      expect(result).not.toContain('.flex')
    })
  })

  describe('JS handling edge cases', () => {
    it('should not transform strings that are not valid class lists', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { }')

      const js = 'const url = "https://example.com/flex"'
      const result = minifier.transformJS(js)
      expect(result).toContain('https://example.com/flex')
    })

    it('should not transform partial matches', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { }')

      const js = 'const x = "flexbox"'
      const result = minifier.transformJS(js)
      expect(result).toContain('flexbox')
    })

    it('should handle template literals with expressions', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .hidden { }')

      const js = 'const x = `flex ${condition ? "hidden" : ""}`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()
      expect(result).toContain(mapping['flex'])
      expect(result).toContain(mapping['hidden'])
    })

    it('should handle partial class prefixes in template literals', () => {
      const minifier = new ClassMinifier({ exclude: [/^fi$/, /^fi-/] })
      minifier.extractFromCSS('.fi { } .fi-home { }')

      const js = 'const x = `fi fi-${code}`'
      const result = minifier.transformJS(js)
      expect(result).toContain('fi fi-')
    })

    it('should transform strings with mixed known and unknown classes', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .items-center { }')

      // "custom-animation" is not in CSS, but flex and items-center are
      const js = 'const x = "flex items-center custom-animation"'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // Known classes should be transformed, unknown should be preserved
      expect(result).toContain(mapping['flex'])
      expect(result).toContain(mapping['items-center'])
      expect(result).toContain('custom-animation')
      // Original class names should NOT be in output
      expect(result).not.toContain('"flex')
      expect(result).not.toContain('items-center')
    })

    it('should not transform strings with no known classes', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { }')

      // None of these are in the CSS
      const js = 'const x = "unknown-class another-unknown"'
      const result = minifier.transformJS(js)
      expect(result).toContain('unknown-class another-unknown')
    })

    it('should not transform strings inside style objects', () => {
      const minifier = new ClassMinifier()
      // 'hidden' and 'visible' are both valid Tailwind classes
      minifier.extractFromCSS('.hidden { display: none; } .visible { visibility: visible; }')

      // Simulates compiled JSX: jsx("div", { style: { overflow: "hidden", visibility: "visible" } })
      const js = 'jsx("div", { style: { overflow: "hidden", visibility: "visible" } })'
      const result = minifier.transformJS(js)

      // Style values should NOT be transformed even though they match class names
      expect(result).toContain('overflow: "hidden"')
      expect(result).toContain('visibility: "visible"')
    })

    it('should transform className but not style in same object', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.hidden { } .flex { }')

      // className should be transformed, style values should not
      const js = 'jsx("div", { className: "hidden flex", style: { overflow: "hidden" } })'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // className value should be transformed
      expect(result).toContain(`className: "${mapping['hidden']} ${mapping['flex']}"`)
      // style value should NOT be transformed
      expect(result).toContain('overflow: "hidden"')
    })
  })

  describe('character set', () => {
    it('should only use letters in generated names', () => {
      const minifier = new ClassMinifier()
      let css = ''
      for (let i = 0; i < 60; i++) {
        css += `.class${String(i)} { } `
      }
      minifier.extractFromCSS(css)

      const mapping = minifier.getMapping()
      const values = Object.values(mapping)
      for (const name of values) {
        expect(name).toMatch(/^[a-zA-Z]+$/)
      }
    })

    it('should generate two-character names after exhausting single chars', () => {
      const minifier = new ClassMinifier()
      let css = ''
      for (let i = 0; i < 60; i++) {
        css += `.class${String(i)} { } `
      }
      minifier.extractFromCSS(css)

      const mapping = minifier.getMapping()
      const values = Object.values(mapping)
      const twoCharNames = values.filter((v) => v.length === 2)
      expect(twoCharNames.length).toBeGreaterThan(0)
    })
  })

  describe('getMapping and getClassCount', () => {
    it('should return correct class count', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.a { } .b { } .c { }')
      expect(minifier.getClassCount()).toBe(3)
    })

    it('should return complete mapping object', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .block { }')

      const mapping = minifier.getMapping()
      expect(mapping).toHaveProperty('flex')
      expect(mapping).toHaveProperty('block')
    })
  })

  describe('whitespace preservation', () => {
    it('should preserve original code formatting', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { display: flex; }')

      const js = `const x = "flex"
const y = 'another'
// comment
function test() {
  return "flex"
}`
      const result = minifier.transformJS(js)

      // Should preserve newlines, comments, indentation
      expect(result).toContain("const y = 'another'")
      expect(result).toContain('// comment')
      expect(result).toContain('function test() {')
      // The class names should be transformed
      const mapping = minifier.getMapping()
      expect(result).toContain(`"${mapping['flex']}"`)
    })

    it('should preserve single quotes in string literals', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { display: flex; }')

      const js = "const x = 'flex'"
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // Should use single quotes
      expect(result).toContain(`'${mapping['flex']}'`)
    })

    it('should preserve double quotes in string literals', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { display: flex; }')

      const js = 'const x = "flex"'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // Should use double quotes
      expect(result).toContain(`"${mapping['flex']}"`)
    })

    it('should preserve comments in code', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { }')

      const js = `
// This is a comment
const x = "flex" // inline comment
/* block comment */
`
      const result = minifier.transformJS(js)
      expect(result).toContain('// This is a comment')
      expect(result).toContain('// inline comment')
      expect(result).toContain('/* block comment */')
    })
  })

  describe('template literal spacing', () => {
    it('should preserve whitespace at expression boundaries', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { } .items-center { }')

      const js = 'const x = `flex ${condition} items-center`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // Should have spaces around the expression
      expect(result).toContain(`\`${mapping['flex']} \${condition} ${mapping['items-center']}\``)
    })

    it('should preserve leading space in template quasi after expression', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.hidden { }')

      const js = 'const x = `${base} hidden`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // The space before "hidden" must be preserved
      expect(result).toContain(`\${base} ${mapping['hidden']}`)
    })

    it('should preserve trailing space in template quasi before expression', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.flex { }')

      const js = 'const x = `flex ${extra}`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // The space after "flex" must be preserved
      expect(result).toContain(`\`${mapping['flex']} \${extra}`)
    })

    it('should handle multiple expressions with proper spacing', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.a { } .b { } .c { }')

      const js = 'const x = `a ${x} b ${y} c`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // All boundary spaces must be preserved
      expect(result).toContain(`\`${mapping['a']} \${x} ${mapping['b']} \${y} ${mapping['c']}\``)
    })

    it('should add spaces at expression boundaries to prevent concatenation', () => {
      const minifier = new ClassMinifier()
      minifier.extractFromCSS('.prefix { }')

      // No space between prefix and expression in original
      const js = 'const x = `prefix${suffix}`'
      const result = minifier.transformJS(js)
      const mapping = minifier.getMapping()

      // Should ADD a trailing space to prevent class concatenation
      expect(result).toContain(`\`${mapping['prefix']} \${suffix}`)
    })
  })
})
