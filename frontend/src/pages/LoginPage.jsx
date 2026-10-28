
import { useState } from "react";

import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useAuth } from "../context/AuthContext";


export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { user, login } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();


  if (user) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    );
  }


  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");
    setSubmitting(true);

    try {
      await login(
        username.trim(),
        password
      );

      navigate("/dashboard");
    } catch (requestError) {
      console.error(
        "Login error:",
        requestError.response?.data || requestError
      );

      const backendError =
        requestError.response?.data?.detail ||
        "Invalid username or password.";

      setError(backendError);
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={handleSubmit}
      >
        {/* BRANDING */}
        <div>
          <h1>
            TAXI MOVE
          </h1>

          
        </div>

        {/* SUCCESS MESSAGE */}
        {location.state?.message && (
          <div className="success-message">
            {location.state.message}
          </div>
        )}

        {/* ERROR MESSAGE */}
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* USERNAME */}
        <input
          value={username}
          onChange={(event) =>
            setUsername(event.target.value)
          }
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          required
        />

        {/* PASSWORD */}
        <input
          value={password}
          onChange={(event) =>
            setPassword(event.target.value)
          }
          placeholder="Password"
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          required
        />

        {/* LOGIN BUTTON */}
        <button
          disabled={submitting}
          type="submit"
        >
          {submitting
            ? "Signing in..."
            : "Login to TAXI MOVE"}
        </button>

        {/* REGISTER */}
        <p>
          New to TAXI MOVE?{" "}
          <Link to="/register">
            Create an account
          </Link>
        </p>

        {/* RETURN HOME */}
        <Link
          to="/"
          className="secondary-button"
          style={{
            display: "block",
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Back to Home
        </Link>
      </form>
    </div>
  );
}