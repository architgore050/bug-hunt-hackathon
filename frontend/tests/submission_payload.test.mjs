import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('submission payload renders markup-looking input as inert text', async () => {
  const server = await createServer({
    configFile: './vite.config.ts',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })

  try {
    const { SubmissionPayload } = await server.ssrLoadModule('/src/components/SubmissionPayload.tsx')
    const payload = {
      description: "<script>alert('xss')</script><img src=x onerror=alert(1)> '; DELETE FROM users; --",
    }
    const html = renderToStaticMarkup(createElement(SubmissionPayload, { payload }))

    assert.match(html, /&lt;script&gt;/i)
    assert.match(html, /&lt;img/i)
    assert.match(html, /DELETE FROM users/)
    assert.doesNotMatch(html, /<script\b|<img\b/i)
  } finally {
    await server.close()
  }
})
