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
        <h1 className="display" style={{ fontSize: 'clamp(6.5rem, 13vw, 10rem)', margin: 0 }}>
          404
        </h1>
        <p className="muted" style={{ maxWidth: 'min(100%, 560px)' }}>
          The page you tried to open does not exist. Check the address, or go back to the previous page.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 24,
          }}
        >
          <button className="btn btn-primary" onClick={() => navigate(-1)}>
            Back to previous page
          </button>
          <Link to="/rules" className="btn">
            Rules
          </Link>
        </div>
      </Panel>
    </div>
  )
}
