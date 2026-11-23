import { Link, useNavigate } from 'react-router-dom'

import { Panel } from '../ui/components'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="wrap page">
      <Panel
        exhibit="EX-404"
        title="Page not found"
        className="notfound-panel"
        bodyClassName="notfound-body"
        ariaLabel="Page not found"
        as="article"
      >
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12, minHeight: '55vh' }}>
          <div>
            <h1 className="display" style={{ fontSize: 'clamp(6.5rem, 13vw, 10rem)', margin: 0 }}>
              404
            </h1>
            <p className="muted" style={{ margin: '8px 0 0', maxWidth: 'min(100%, 560px)' }}>
              The page you tried to open does not exist. Check the address, or go back to the previous page.
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button className="btn btn-primary" onClick={() => navigate(-1)}>
              Back to previous page
            </button>
            <Link to="/rules" className="btn">
              Rules
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  )
}
