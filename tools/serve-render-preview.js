import { createServer } from 'vite'
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 5178, strictPort: true }, esbuild: { target: 'esnext' }, optimizeDeps: { esbuildOptions: { target: 'esnext' } } })
await server.listen()
console.log('Render-only verification: http://127.0.0.1:5178/tools/render-preview.html')
