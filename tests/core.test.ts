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
  })

  describe('character set', () => {
    it('should use underscore in generated names', () => {
      const minifier = new ClassMinifier()
      // Generate enough classes to use underscore (53rd character)
      let css = ''
      for (let i = 0; i < 60; i++) {
        css += `.class${String(i)} { } `
      }
      minifier.extractFromCSS(css)

      const mapping = minifier.getMapping()
      const values = Object.values(mapping)
      expect(values).toContain('_')
    })

    it('should generate two-character names after exhausting single chars', () => {
      const minifier = new ClassMinifier()
      // Generate 60 classes (more than 53 available)
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
})
