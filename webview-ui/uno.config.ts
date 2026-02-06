import { defineConfig } from 'unocss'
import presetUno from '@unocss/preset-uno'

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      accent: '#2dd4bf',
      amber: '#f59e0b',
      slate: {
        100: '#e2e8f0',
        200: '#cbd5f5',
        300: '#a7b3c2',
        400: '#8a96a3',
        500: '#64748b',
      },
    },
  },
})
