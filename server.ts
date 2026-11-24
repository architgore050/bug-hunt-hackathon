import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import { apiErrorMiddleware, createApiRouter } from './server/routes.ts'

async function start() {
  const app = express()
  app.set('trust proxy', 1)

  app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex'))
    ;(req as express.Request & { requestId: string }).requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })

  app.use(cookieParser())
  app.use(express.json({ limit: '512kb' }))

  app.use(createApiRouter())
  app.use('/v1', apiErrorMiddleware)

  const isProd = process.env.NODE_ENV === 'production'
  const frontendRoot = path.resolve(process.cwd(), 'frontend')
  const distDir = path.join(frontendRoot, 'dist')

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir))
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } else {
    const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'))
    const viteEntry = pathToFileURL(frontendRequire.resolve('vite')).href
    const { createServer: createViteServer } = await import(viteEntry)
    const vite = await createViteServer({
      root: frontendRoot,
      configFile: path.join(frontendRoot, 'vite.config.ts'),
      server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true, hmr: false },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  const port = Number(process.env.PORT) || 3000
  app.listen(port, '0.0.0.0', () => {
    console.log(`Bug Hunt CTF platform listening on http://0.0.0.0:${port}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
