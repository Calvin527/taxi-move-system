
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

const initialForm = {
  username: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  password: "",
  password_confirm: "",
};

function getErrorMessage(requestError) {
  const data = requestError.response?.data;

  if (!data) {
    return "Registration failed. Please check if the backend server is running.";
  }

  if (typeof data === "string") {
    return data;
  }

  if (data.detail) {
    return String(data.detail);
  }

  if (typeof data === "object") {
    const firstField = Object.keys(data)[0];
    const firstValue = data[firstField];

    if (Array.isArray(firstValue)) {
      return `${firstField}: ${firstValue[0]}`;
    }

    return `${firstField}: ${String(firstValue)}`;
  }

  return "Registration failed. Please try again.";
}

export default function RegisterPage() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { registerPassenger } = useAuth();
  const navigate = useNavigate();

  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (form.password !== form.password_confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    const payload = {
      username: form.username.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone_number: form.phone_number.trim(),
      password: form.password,
      password_confirm: form.password_confirm,
    };

    try {
      await registerPassenger(payload);

      navigate("/login", {
        state: {
          message: "Registration successful. Please log in.",
        },
      });
    } catch (requestError) {
      console.error("Registration error:", requestError.response?.data || requestError);
      setError(getErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create passenger account</h1>
        <p>Register to access TaxiLink waiting services.</p>

        {error && <div className="error-message">{error}</div>}

        <input
          name="username"
          placeholder="Username"
          value={form.username}
          onChange={handleChange}
          autoComplete="username"
          required
        />

        <div className="form-row">
          <input
            name="first_name"
            placeholder="First name"
            value={form.first_name}
            onChange={handleChange}
            autoComplete="given-name"
            required
          />

          <input
            name="last_name"
            placeholder="Last name"
            value={form.last_name}
            onChange={handleChange}
            autoComplete="family-name"
            required
          />
        </div>

        <input
          name="email"
          type="email"
          placeholder="Email address"
          value={form.email}
          onChange={handleChange}
          autoComplete="email"
          required
        />

        <input
          name="phone_number"
          placeholder="Phone number"
          value={form.phone_number}
          onChange={handleChange}
          autoComplete="tel"
          required
        />

        <input
          name="password"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          autoComplete="new-password"
          required
        />

        <input
          name="password_confirm"
          type="password"
          placeholder="Confirm password"
          value={form.password_confirm}
          onChange={handleChange}
          autoComplete="new-password"
          required
        />

        <button disabled={submitting} type="submit">
          {submitting ? "Creating account..." : "Register"}
        </button>

        <p>
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}