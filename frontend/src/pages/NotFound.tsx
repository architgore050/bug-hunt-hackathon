import { Link, useNavigate } from "react-router-dom";

import { Panel } from "../ui/components";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="wrap page">
      <Panel exhibit="EX-404" title="Page not found" ariaLabel="Page not found">
        <p
          className="muted"
          style={{ margin: 0, maxWidth: "min(100%, 560px)" }}
        >
          The page you tried to open does not exist. Check the address, or go
          back to the previous page.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 16,
            justifyContent: "center",
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
  );
}
