import { ClassMinifier, type ClassMinifierOptions } from './core.js'

/**
 * Configuration options for the Vite plugin
 */
export interface ClassMinifierPluginOptions extends ClassMinifierOptions {
  /** Enable verbose logging and output class-map.json */
  verbose?: boolean
}

interface CSSAsset {
  source: string
}

interface JSChunk {
  code: string
}

interface BundleChunk {
  type: string
  source?: string
  code?: string
}

interface PluginContext {
  emitFile: (file: { type: string; fileName: string; source: string }) => void
}

function isCSSAsset(name: string, chunk: BundleChunk): chunk is BundleChunk & CSSAsset {
  return (
    name.endsWith('.css') && chunk.type === 'asset' && typeof chunk.source === 'string'
  )
}

function isJSChunk(chunk: BundleChunk): chunk is BundleChunk & JSChunk {
  return chunk.type === 'chunk' && typeof chunk.code === 'string'
}

/**
 * Vite plugin that minifies CSS class names in the build output.
 *
 * @example
 * ```ts
 * import mimicss from 'mimicss/vite-plugin'
 *
 * export default defineConfig({
 *   plugins: [
 *     mimicss({
 *       verbose: true,
 *       exclude: [/^fi$/, /^fi-/], // Exclude flag-icon classes
 *     }),
 *   ],
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function classMinifierPlugin(options: ClassMinifierPluginOptions = {}): any {
  const minifier = new ClassMinifier({ exclude: options.exclude })

  return {
    name: 'class-minifier',
    enforce: 'post',
    apply: 'build',

    generateBundle(
      this: PluginContext,
      _outputOptions: unknown,
      bundle: Record<string, BundleChunk>,
    ) {
      const cssAssets: CSSAsset[] = []
      const jsChunks: JSChunk[] = []

      for (const [name, chunk] of Object.entries(bundle)) {
        if (isCSSAsset(name, chunk)) {
          cssAssets.push(chunk)
        } else if (isJSChunk(chunk)) {
          jsChunks.push(chunk)
        }
      }

      // 1: analyze JS to count class usage
      for (const chunk of jsChunks) {
        try {
          minifier.analyzeJS(chunk.code)
        } catch {
          // some chunks may not be parseable
        }
      }

      // 2: extract classes from CSS and build mapping
      for (const asset of cssAssets) {
        minifier.extractFromCSS(asset.source)
      }

      if (options.verbose) {
        console.log(`[class-minifier] Found ${minifier.getClassCount().toString()} classes`)
      }

      // 3: transform CSS
      for (const asset of cssAssets) {
        asset.source = minifier.transformCSS(asset.source)
      }

      // 3: transform JS
      for (const chunk of jsChunks) {
        try {
          chunk.code = minifier.transformJS(chunk.code)
        } catch (error) {
          if (options.verbose) {
            console.log('[class-minifier] Error transforming JS:', error)
          }
        }
      }

      // Emit class mapping
      if (options.verbose) {
        this.emitFile({
          type: 'asset',
          fileName: 'class-map.json',
          source: JSON.stringify(minifier.getMapping(), null, 2),
        })
      }
    },
  }
}
