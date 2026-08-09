import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";


export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();


  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };


  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>TaxiLink</h1>
          <small>
            Smart Taxi Demand Monitoring and Dispatch
          </small>
        </div>

        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/routes">Routes</NavLink>
          <NavLink to="/profile">Profile</NavLink>
        {["DRIVER", "DISPATCHER"].includes(user.role) && (
  <NavLink to="/dispatch">
    Dispatch
  </NavLink>
)}
          <button
            className="link-button"
            onClick={handleLogout}
            type="button"
          >
            Logout
          </button>
        </nav>
      </header>

      <main className="page-container">
        <div className="user-summary">
          Signed in as <strong>{user.username}</strong>
          {" · "}
          {user.role_display}
        </div>

        {children}
      </main>
    </div>
  );
}