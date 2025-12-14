# mimicss

Experimental CSS class name minifier

**Note:** Only actually "tested" with Vite + React.js projects so far, true support for anything else is underway 

## Install

```bash
npm install mimicss
```

## Usage (Vite)

```ts
import { defineConfig } from 'vite'
import mimicss from 'mimicss/vite-plugin'

export default defineConfig({
  plugins: [
    mimicss({
      verbose: true, // outputs class-map.json
      exclude: [/^fi$/, /^fi-/], // exclude patterns
    }),
  ],
})
```

## How it works

1. Analyzes JS to find classname strings
2. Extracts classes from CSS
3. Assigns shorter names to more frequently used classes
4. Transforms both CSS and JS in the build output

In almost all cases, you'll have to utilize the `exclude` option to avoid problems with dynamically assigned or generated classes, or false positives / unwanted behaviour during the class name collection.

## License

MIT
