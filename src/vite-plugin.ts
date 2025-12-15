import { ClassMinifier, type ClassMinifierOptions } from './core.js'

export interface ClassMinifierPluginOptions extends ClassMinifierOptions {
  verbose?: boolean
}

interface OutputAsset {
  type: 'asset'
  source: string
}

interface OutputChunk {
  type: 'chunk'
  code: string
}

type BundleEntry = OutputAsset | OutputChunk | { type: string }

function isCSSAsset(name: string, chunk: BundleEntry): chunk is OutputAsset {
  return (
    name.endsWith('.css') &&
    chunk.type === 'asset' &&
    'source' in chunk &&
    typeof chunk.source === 'string'
  )
}

function isJSChunk(chunk: BundleEntry): chunk is OutputChunk {
  return chunk.type === 'chunk' && 'code' in chunk && typeof chunk.code === 'string'
}

export default function mimicssVitePlugin(options: ClassMinifierPluginOptions = {}) {
  const minifier = new ClassMinifier({ exclude: options.exclude })

  return {
    name: 'class-minifier',
    enforce: 'post' as const,
    apply: 'build' as const,

    generateBundle(_outputOptions: unknown, bundle: Record<string, BundleEntry>) {
      const cssAssets: OutputAsset[] = []
      const jsChunks: OutputChunk[] = []

      for (const [name, chunk] of Object.entries(bundle)) {
        if (isCSSAsset(name, chunk)) {
          cssAssets.push(chunk)
        } else if (isJSChunk(chunk)) {
          jsChunks.push(chunk)
        }
      }

      for (const chunk of jsChunks) {
        try {
          minifier.analyzeJS(chunk.code)
        } catch {
          // some chunks may not be parseable
        }
      }

      for (const asset of cssAssets) {
        minifier.extractFromCSS(asset.source)
      }

      if (options.verbose) {
        console.log(`[class-minifier] Found ${minifier.getClassCount().toString()} classes`)
      }

      for (const asset of cssAssets) {
        asset.source = minifier.transformCSS(asset.source)
      }

      for (const chunk of jsChunks) {
        try {
          chunk.code = minifier.transformJS(chunk.code)
        } catch (error) {
          if (options.verbose) {
            console.log('[class-minifier] Error transforming JS:', error)
          }
        }
      }

      if (options.verbose) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        ;(this as any).emitFile({
          type: 'asset',
          fileName: 'class-map.json',
          source: JSON.stringify(minifier.getMapping(), null, 2),
        })
      }
    },
  }
}
