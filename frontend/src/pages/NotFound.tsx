import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="wrap page" style={{ display: 'grid', justifyContent: 'center' }}>
      <div style={{ width: 'min(100%, 480px)', display: 'grid', gap: 14, paddingTop: '10vh' }}>
        <span className="exhibit-num">EX-404</span>
        <h1 className="display" style={{ margin: 0, fontSize: 'clamp(1.8rem, 5vw, 2.6rem)' }}>Page not in the file</h1>
        <p className="muted">
          The address you followed does not match any page of this console. Check the address or start from the
          case cover.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/" className="btn btn-primary">Back to the landing page</Link>
          <Link to="/rules" className="btn btn-ghost">Rules</Link>
        </div>
      </div>
    </div>
  )
}
