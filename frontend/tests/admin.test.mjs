import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

async function withModule(path, run) {
  const server = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true }, appType: 'custom' })
  try {
    const mod = await server.ssrLoadModule(path)
    await run(mod)
  } finally {
    await server.close()
  }
}

test('parseCsv handles quoted fields, commas, escaped quotes and CRLF', async () => {
  await withModule('/src/admin/csv.ts', ({ parseCsv }) => {
    const csv = 'name,email,team\r\n"Doe, Jane","jane@example.com","Team, A"\r\nBob,"b""ob@example.com",TeamB'
    const { headers, rows } = parseCsv(csv)
    assert.deepEqual(headers, ['name', 'email', 'team'])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].raw.name, 'Doe, Jane')
    assert.equal(rows[0].raw.team, 'Team, A')
    assert.equal(rows[1].raw.email, 'b"ob@example.com')
  })
})

test('validateParticipantRow flags missing name/email and bad email', async () => {
  await withModule('/src/admin/csv.ts', ({ validateParticipantRow }) => {
    assert.equal(validateParticipantRow({ name: 'A', email: 'a@b.com' }).length, 0)
    assert.ok(validateParticipantRow({ name: '', email: 'a@b.com' }).some((i) => i.field === 'name'))
    assert.ok(validateParticipantRow({ name: 'A', email: 'not-an-email' }).some((i) => i.field === 'email'))
    assert.ok(validateParticipantRow({ name: 'A', email: '' }).some((i) => i.field === 'email'))
  })
})

test('normalizeParticipantRow lowercases email and picks id', async () => {
  await withModule('/src/admin/csv.ts', ({ normalizeParticipantRow }) => {
    const r = normalizeParticipantRow({ Name: 'A', Email: 'A@B.COM', 'participant id': 'P-1', Team: 'X' })
    assert.equal(r.email, 'a@b.com')
    assert.equal(r.id, 'P-1')
    assert.equal(r.team, 'X')
  })
})

function team(over = {}) {
  return { id: 't1', name: 'T', status: 'active', capacity: 5, createdAt: '', joinCode: '', functionalScore: 40, evaluationScore: 10, ctfBonus: 5, penalties: 3, ...over }
}

test('teamTotal = functional + evaluation + ctf - penalties + positive adjustments - applied penalties', async () => {
  await withModule('/src/admin/scoring.ts', ({ teamTotal, penaltiesFor }) => {
    const t = team()
    assert.equal(teamTotal(t, []), 40 + 10 + 5 - 3)
    const adjustments = [
      { id: '1', teamId: 't1', teamName: 'T', amount: 5, reason: '', category: 'administrative', adminIdentity: '', timestamp: '', previousScore: 0, updatedScore: 0, incidentId: null },
      { id: '2', teamId: 't1', teamName: 'T', amount: -4, reason: '', category: 'penalty', adminIdentity: '', timestamp: '', previousScore: 0, updatedScore: 0, incidentId: null },
    ]
    assert.equal(penaltiesFor(t, adjustments), 3 + 4)
    assert.equal(teamTotal(t, adjustments), 40 + 10 + 5 - 3 - 4 + 5)
    const otherTeam = [{ id: '3', teamId: 'zz', teamName: '', amount: 100, reason: '', category: 'administrative', adminIdentity: '', timestamp: '', previousScore: 0, updatedScore: 0, incidentId: null }]
    assert.equal(teamTotal(t, otherTeam), 40 + 10 + 5 - 3)
  })
})
