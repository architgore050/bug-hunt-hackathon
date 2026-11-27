import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import { errorMiddleware } from './server/errors.ts'
import { createApiRouter } from './server/routes.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_DIR = path.join(__dirname, 'frontend')
const DIST_DIR = path.join(FRONTEND_DIR, 'dist')
const PORT = Number(process.env.PORT || 3000)

async function startServer() {
  const app = express()
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    const rid = crypto.randomUUID().slice(0, 8)
    ;(req as express.Request & { requestId?: string }).requestId = rid
    res.setHeader('X-Request-Id', rid)
    next()
  })

  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  app.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() })
  })

  app.use('/v1', createApiRouter())

  // API 404 JSON envelope before falling through to SPA
  app.use('/v1', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found.',
        request_id: '-',
        details: {},
      },
    })
  })

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(DIST_DIR)

  if (isProd) {
    app.use(express.static(DIST_DIR))
    app.get('/{*rest}', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'))
    })
  } else {
    const frontendRequire = createRequire(path.join(FRONTEND_DIR, 'package.json'))
    const { createServer: createViteServer } = frontendRequire('vite') as typeof import('vite')
    const vite = await createViteServer({
      root: FRONTEND_DIR,
      configFile: path.join(FRONTEND_DIR, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.use(errorMiddleware)

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[bug-hunt-ctf] listening on http://0.0.0.0:${PORT}`)
  })
}

startServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
