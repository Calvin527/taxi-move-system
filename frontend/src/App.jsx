
import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";

import DashboardPage from "./pages/DashboardPage";
import DispatchPage from "./pages/DispatchPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import RegisterPage from "./pages/RegisterPage";
import RoutesPage from "./pages/RoutesPage";
import AddWaitingSpotPage from "./pages/AddWaitingSpotPage";

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<HomePage />}
      />

      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/register"
        element={<RegisterPage />}
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/dispatch"
        element={
          <ProtectedRoute>
            <DispatchPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/routes"
        element={
          <ProtectedRoute>
            <RoutesPage />
          </ProtectedRoute>
        }
      />

      {/* CREATE WAITING SPOT */}

      <Route
        path="/routes/:routeId/waiting-spots/new"
        element={
          <ProtectedRoute>
            <AddWaitingSpotPage />
          </ProtectedRoute>
        }
      />

      {/* EDIT WAITING SPOT */}

      <Route
        path="/routes/:routeId/waiting-spots/:spotId/edit"
        element={
          <ProtectedRoute>
            <AddWaitingSpotPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}