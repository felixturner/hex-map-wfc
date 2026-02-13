import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const fullReloadAlways = {
  name: 'full-reload-always',
  handleHotUpdate({ server }) {
    server.ws.send({ type: "full-reload" })
    return []
  },
}

export default defineConfig({
  root: '',
  base: './',
  plugins: [fullReloadAlways, basicSsl()],
  server: {
    watch: {
      ignored: ['**/*.md', '**/*.txt'],
    },
  },
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
})
