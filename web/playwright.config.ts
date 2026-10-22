import { defineConfig, devices } from '@playwright/test'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// E2E runs against the real backend serving the built web app, with a fresh SQLite DB.
// Build first: `npm run build`, then `npm run test:e2e`.
const PORT = 8010
// One fresh DB per run. The config is also loaded by workers, so the name is passed
// down through the environment instead of being recreated (the server holds the file).
mkdirSync(resolve(HERE, '../api/data'), { recursive: true })
if (!process.env.E2E_DB) {
  process.env.E2E_DB = resolve(HERE, `../api/data/e2e-${Date.now()}.db`)
  for (const f of readdirSync(resolve(HERE, '../api/data')).filter((n) => n.startsWith('e2e-'))) {
    try { rmSync(resolve(HERE, '../api/data', f), { force: true }) } catch { /* still open from an old run */ }
  }
}
const DB = process.env.E2E_DB

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `${join('.venv', 'Scripts', 'python')} -m uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
    cwd: resolve(HERE, '../api'),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: `sqlite+aiosqlite:///${DB.split(sep).join('/')}`, SELLER_KEY: 'e2e-key', OPENROUTER_API_KEY: '', EXPIRY_INTERVAL_S: '1' },
  },
})
