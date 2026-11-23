import { Link, useNavigate } from 'react-router-dom'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center' }}>
      <div style={{ width: 'min(100%, 480px)', display: 'grid', gap: 14, paddingTop: '10vh' }}>
        <span className="exhibit-num">EX-404</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.8rem, 5vw, 2.6rem)' }}>Page not found</h1>
        <p className="muted">
          The page you tried to open does not exist. Check the address, or go back to the previous page.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate(-1)}>Back to previous page</button>
          <Link to="/rules" className="btn btn-ghost">Rules</Link>
        </div>
      </div>
    </div>
  )
}
