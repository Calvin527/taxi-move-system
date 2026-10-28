
import {
  NavLink,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../context/AuthContext";


export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const navClass = ({ isActive }) =>
    isActive
      ? "nav-link active"
      : "nav-link";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            TM
          </div>

          <div>
            <h1>
              TAXI MOVE
            </h1>

            <small>
              Smart Taxi Dispatch & Passenger Management
            </small>
          </div>
        </div>

        <nav className="main-navigation">
          <NavLink
            className={navClass}
            to="/dashboard"
          >
            Dashboard
          </NavLink>

          <NavLink
            className={navClass}
            to="/routes"
          >
            Routes
          </NavLink>

          {["DRIVER", "DISPATCHER"].includes(
            user?.role
          ) && (
            <NavLink
              className={navClass}
              to="/dispatch"
            >
              Dispatch
            </NavLink>
          )}

          <NavLink
            className={navClass}
            to="/profile"
          >
            Profile
          </NavLink>

          <button
            className="logout-button"
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </nav>
      </header>

      <main className="page-container">
        <div className="user-summary">
          <div className="user-avatar">
            {user?.username
              ?.charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <span className="user-summary-label">
              Signed in as
            </span>

            <strong>
              {user?.username}
            </strong>
          </div>

          <span className="role-badge">
            {user?.role_display}
          </span>
        </div>

        {children}
      </main>
    </div>
  );
}