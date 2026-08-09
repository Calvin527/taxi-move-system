import { useState } from "react";

import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


export default function ProfilePage() {
  const { user, updateProfile } = useAuth();

  const [form, setForm] = useState({
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    phone_number: user.phone_number ?? "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");


  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };


  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      await updateProfile(form);
      setMessage("Profile updated successfully.");
    } catch {
      setError("The profile could not be updated.");
    }
  };


  return (
    <AppLayout>
      <section className="profile-card">
        <h2>My Profile</h2>

        {message && (
          <div className="success-message">{message}</div>
        )}

        {error && (
          <div className="error-message">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input value={user.username} disabled />
          </label>

          <label>
            Email
            <input value={user.email} disabled />
          </label>

          <label>
            Role
            <input value={user.role_display} disabled />
          </label>

          <label>
            First name
            <input
              name="first_name"
              value={form.first_name}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Last name
            <input
              name="last_name"
              value={form.last_name}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Phone number
            <input
              name="phone_number"
              value={form.phone_number}
              onChange={handleChange}
              required
            />
          </label>

          <button type="submit">Save changes</button>
        </form>
      </section>
    </AppLayout>
  );
}