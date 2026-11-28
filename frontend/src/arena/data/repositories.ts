import type { Language, RepoFile, RepoTreeNode } from '../types'

const languageFor = (path: string): Language => {
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.md') || path.endsWith('.example')) return 'markdown'
  return 'text'
}

/** Build a nested explorer tree from the flat file list. */
const buildTree = (files: RepoFile[]): RepoTreeNode[] => {
  const root: RepoTreeNode[] = []
  for (const file of files) {
    const parts = file.path.split('/')
    let level = root
    let prefix = ''
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part
      const isFile = index === parts.length - 1
      const existing = level.find((node) => node.name === part)
      if (isFile) {
        if (!existing) {
          level.push({ type: 'file', name: part, path: file.path, language: file.language, modified: file.modified })
        }
      } else if (existing && existing.type === 'folder') {
        level = existing.children
      } else {
        const folder: RepoTreeNode = { type: 'folder', name: part, path: prefix, children: [] }
        level.push(folder)
        level = folder.children
      }
    })
  }
  return root
}

const makeRepo = (
  id: string,
  name: string,
  description: string,
  assignedLevel: string,
  tags: string[],
  branch: string,
  entries: Array<[string, string, boolean?]>,
  recentPaths: string[],
) => {
  const files: RepoFile[] = entries.map(([path, content, modified]) => ({
    path,
    content: content.replace(/^\n/, '').replace(/\n$/, ''),
    language: languageFor(path),
    modified,
  }))
  return { id, name, description, assignedLevel, tags, branch, files, tree: buildTree(files), recentPaths }
}

const papyrus = makeRepo(
  'repo-papyrus',
  'papyrus',
  'A lightweight notes API with a small React client. Several defects were introduced for the competition.',
  'Levels 1 to 3',
  ['Node.js', 'Express', 'React', 'JavaScript'],
  'challenge/main',
  [
    ['README.md', `
# Papyrus

A minimal notes service used for The Fall Back challenge.

## Run locally

    npm install
    npm start

The API listens on port 3100. The client talks to /api.
`],
    ['package.json', `
{
  "name": "papyrus",
  "version": "1.4.2",
  "main": "server/app.js",
  "scripts": { "start": "node server/app.js", "test": "node --test" },
  "dependencies": { "express": "4.18.2", "jsonwebtoken": "9.0.0" }
}
`],
    ['server/app.js', `
const express = require('express')
const notes = require('./routes/notes')
const config = require('../config/default.json')

const app = express()
app.use(express.json())
app.use('/api', notes)

app.listen(config.port, () => {
  console.log('Papyrus listening on ' + config.port)
})

module.exports = app
`],
    ['server/db.js', `
const store = {
  notes: [
    { id: 'n1', owner: 'u-1', title: 'Meeting notes', votes: 3 },
    { id: 'n2', owner: 'u-2', title: 'Release checklist', votes: 1 }
  ],
  save() {
    return true
  }
}

module.exports = store
`],
    ['server/middleware/auth.js', `
function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }

  const token = header.split(' ')[1]
  req.user = { id: req.params.userId || req.query.userId }

  return next()
}

module.exports = { authenticate }
`],
    ['server/routes/notes.js', `
const express = require('express')
const { authenticate } = require('../middleware/auth')
const { grandTotal } = require('../utils/totals')
const db = require('../db')

const router = express.Router()

router.get('/:userId/notes', authenticate, (req, res) => {
  const notes = db.notes.filter((note) => note.owner === req.user.id)
  res.json(notes)
})

router.post('/vote/:noteId', authenticate, (req, res) => {
  const note = db.notes.find((n) => n.id === req.params.noteId)
  if (!note) return res.status(404).json({ error: 'Note not found' })

  const current = note.votes
  setTimeout(() => {
    note.votes = current + 1
    db.save()
  }, 10)

  res.json({ ok: true })
})

router.get('/totals', (req, res) => {
  res.json({ total: grandTotal(req.body.items || []) })
})

module.exports = router
`],
    ['server/utils/totals.js', `
function grandTotal(items) {
  return items.reduce((sum, item) => {
    return sum + item.price
  }, 0)
}

module.exports = { grandTotal }
`],
    ['src/api/client.js', `
export async function fetchNotes(userId, token) {
  const response = await fetch('/api/' + userId + '/notes', {
    headers: { Authorization: 'Bearer ' + token }
  })
  if (!response.ok) throw new Error('Request failed')
  return response.json()
}

export async function castVote(noteId) {
  return fetch('/api/vote/' + noteId, { method: 'POST' })
}
`],
    ['src/components/NoteList.jsx', `
import React from 'react'

export default function NoteList({ notes }) {
  return (
    <ul className="note-list">
      {notes.map((note) => (
        <li key={note.id}>
          <span dangerouslySetInnerHTML={{ __html: note.title }} />
          <small>{note.owner}</small>
        </li>
      ))}
    </ul>
  )
}
`],
    ['config/default.json', `
{
  "service": "papyrus",
  "port": 3100,
  "adminToken": "sample-static-token-do-not-ship",
  "featureFlags": { "search": true, "export": false }
}
`],
    ['.env.example', `
PORT=3100
NODE_ENV=development
JWT_SECRET=replace-me-before-event
`],
  ],
  ['server/middleware/auth.js', 'server/utils/totals.js', 'server/routes/notes.js', 'src/components/NoteList.jsx'],
)

const marina = makeRepo(
  'repo-marina',
  'marina',
  'A FastAPI pricing service on SQLite. The final challenge repository, issued fresh at Level 4.',
  'Level 4',
  ['Python', 'FastAPI', 'SQLite'],
  'final/clean',
  [
    ['README.md', `
# Marina

A small pricing API for the final challenge.

Run the checks with:

    python -m pytest tests -q

The service uses SQLite and has no network dependencies.
`],
    ['requirements.txt', `
fastapi==0.115.0
uvicorn==0.30.0
sqlalchemy==2.0.30
pytest==8.2.0
`],
    ['app/main.py', `
from fastapi import FastAPI
from app.routers import items

app = FastAPI(title="Marina")
app.include_router(items.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
`],
    ['app/models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    price = Column(Integer, nullable=False)
`],
    ['app/services/pricing.py', `
def total_with_tax(subtotal: int, rate: int, discount: int = 0) -> float:
    discounted = subtotal - discount
    return discounted * (1 + rate // 100)


def shipping_cost(weight: int) -> int:
    if weight > 10:
        return 500
    return 200
`],
    ['app/routers/items.py', `
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.models import Item
from app.services.pricing import total_with_tax

router = APIRouter()


def get_db():
    return Session()


@router.get("/items/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    return item


@router.get("/quote/{item_id}")
def quote(item_id: int, rate: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    return {"total": total_with_tax(item.price, rate)}
`],
    ['tests/test_items.py', `
from app.services.pricing import total_with_tax


def test_tax_is_applied():
    assert total_with_tax(1000, 10) == 1100


def test_discount_is_applied():
    assert total_with_tax(1000, 10, 100) == 990
`],
  ],
  ['app/services/pricing.py', 'app/routers/items.py', 'tests/test_items.py'],
)

export const repositories = { papyrus, marina }

export type RepositoryId = keyof typeof repositories
