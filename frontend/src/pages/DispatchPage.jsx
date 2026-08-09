import {
  useCallback,
  useEffect,
  useState,
} from "react";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


const initialForm = {
  driver: "",
  waiting_spot: "",
  passenger_count: 1,
  notes: "",
};


function extractError(error, fallback) {
  const data = error.response?.data;

  if (!data) {
    return fallback;
  }

  const firstValue = Object.values(data).flat()[0];

  if (
    typeof firstValue === "object"
    && firstValue !== null
  ) {
    return String(Object.values(firstValue).flat()[0]);
  }

  return String(firstValue || fallback);
}


export default function DispatchPage() {
  const { user } = useAuth();

  const [assignments, setAssignments] = useState([]);
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [waitingSpots, setWaitingSpots] = useState([]);
  const [availability, setAvailability] = useState(null);

  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isDriver = user.role === "DRIVER";
  const isDispatcher = user.role === "DISPATCHER";


  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const assignmentsResponse = await api.get(
          "/transport/dispatches/"
        );

        setAssignments(assignmentsResponse.data);

        if (isDriver) {
          const availabilityResponse = await api.get(
            "/transport/drivers/availability/"
          );

          setAvailability(availabilityResponse.data);
        }

        if (isDispatcher) {
          const [
            driversResponse,
            spotsResponse,
          ] = await Promise.all([
            api.get("/transport/drivers/available/"),
            api.get("/transport/waiting-spots/"),
          ]);

          setAvailableDrivers(driversResponse.data);

          setWaitingSpots(
            spotsResponse.data.filter(
              (spot) =>
                spot.is_active
                && spot.active_waiting_count > 0
            )
          );
        }
      } catch {
        setError("Dispatch information could not be loaded.");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [isDriver, isDispatcher]
  );


  useEffect(() => {
    loadData();

    const interval = window.setInterval(() => {
      loadData(true);
    }, 10000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadData]);


  const handleChange = (event) => {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  };


  const toggleAvailability = async () => {
    setError("");
    setMessage("");
    setUpdating(true);

    try {
      const response = await api.patch(
        "/transport/drivers/availability/",
        {
          is_available: !availability.is_available,
        }
      );

      setAvailability(response.data);

      setMessage(
        response.data.is_available
          ? "You are now available for dispatch."
          : "You are now unavailable."
      );
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Availability could not be updated."
        )
      );
    } finally {
      setUpdating(false);
    }
  };


  const createDispatch = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await api.post(
        "/transport/dispatches/",
        {
          ...form,
          driver: Number(form.driver),
          waiting_spot: Number(form.waiting_spot),
          passenger_count: Number(form.passenger_count),
        }
      );

      setForm(initialForm);
      setMessage("Driver dispatched successfully.");

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "The dispatch could not be created."
        )
      );
    }
  };


  const respondToDispatch = async (
    assignmentId,
    response
  ) => {
    setError("");
    setMessage("");

    try {
      await api.post(
        `/transport/dispatches/${assignmentId}/${response}/`
      );

      setMessage(
        response === "accept"
          ? "Dispatch accepted."
          : "Dispatch rejected."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "The dispatch response could not be saved."
        )
      );
    }
  };


  return (
    <AppLayout>
      <section className="page-heading">
        <h2>Taxi Dispatch</h2>

        <p>
          Dispatch information refreshes automatically every
          10 seconds.
        </p>
      </section>

      {message && (
        <div className="success-message">
          {message}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {isDriver && availability && (
        <section className="availability-card">
          <div>
            <h3>Driver Availability</h3>

            <span
              className={
                availability.is_available
                  ? "status-badge active"
                  : "status-badge inactive"
              }
            >
              {availability.is_available
                ? "Available"
                : "Unavailable"}
            </span>
          </div>

          <button
            className={
              availability.is_available
                ? "danger-button"
                : "action-button"
            }
            type="button"
            disabled={updating}
            onClick={toggleAvailability}
          >
            {updating
              ? "Updating..."
              : availability.is_available
                ? "Go unavailable"
                : "Go available"}
          </button>
        </section>
      )}

      {isDispatcher && (
        <section className="form-card dispatch-form">
          <h3>Create Dispatch Assignment</h3>

          <form onSubmit={createDispatch}>
            <label>
              Available driver

              <select
                name="driver"
                value={form.driver}
                onChange={handleChange}
                required
              >
                <option value="">
                  Select driver
                </option>

                {availableDrivers.map((driver) => (
                  <option
                    key={driver.id}
                    value={driver.id}
                  >
                    {driver.full_name}
                    {" — "}
                    {driver.username}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Waiting spot

              <select
                name="waiting_spot"
                value={form.waiting_spot}
                onChange={handleChange}
                required
              >
                <option value="">
                  Select waiting spot
                </option>

                {waitingSpots.map((spot) => (
                  <option
                    key={spot.id}
                    value={spot.id}
                  >
                    {spot.name}
                    {" — "}
                    {spot.active_waiting_count} waiting
                  </option>
                ))}
              </select>
            </label>

            <label>
              Number of passengers

              <input
                name="passenger_count"
                type="number"
                min="1"
                value={form.passenger_count}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              Notes

              <textarea
                name="notes"
                rows="3"
                value={form.notes}
                onChange={handleChange}
                placeholder="Optional instructions for the driver"
              />
            </label>

            <button type="submit">
              Dispatch driver
            </button>
          </form>

          {availableDrivers.length === 0 && (
            <p className="empty-note">
              No drivers are currently available.
            </p>
          )}

          {waitingSpots.length === 0 && (
            <p className="empty-note">
              No waiting spots currently have passenger demand.
            </p>
          )}
        </section>
      )}

      <section className="dispatch-list">
        <h3>
          {isDriver
            ? "My Dispatch Assignments"
            : "Dispatch Activity"}
        </h3>

        {loading && (
          <div className="page-message">
            Loading dispatches...
          </div>
        )}

        {!loading && assignments.length === 0 && (
          <div className="route-card">
            No dispatch assignments yet.
          </div>
        )}

        {!loading && assignments.map((assignment) => (
          <article
            className="dispatch-card"
            key={assignment.id}
          >
            <div>
              <div className="dispatch-title-row">
                <h4>{assignment.waiting_spot_name}</h4>

                <span
                  className={`dispatch-status ${assignment.status.toLowerCase()}`}
                >
                  {assignment.status_display}
                </span>
              </div>

              <p>
                Route: {assignment.route_name}
              </p>

              <p>
                Driver: {assignment.driver_name}
              </p>

              <p>
                Passengers requested:{" "}
                {assignment.passenger_count}
              </p>

              {assignment.notes && (
                <p>
                  Notes: {assignment.notes}
                </p>
              )}

              <small>
                Created:{" "}
                {new Date(
                  assignment.created_at
                ).toLocaleString()}
              </small>
            </div>

            {isDriver
              && assignment.status === "PENDING" && (
                <div className="dispatch-actions">
                  <button
                    className="action-button"
                    type="button"
                    onClick={() =>
                      respondToDispatch(
                        assignment.id,
                        "accept"
                      )
                    }
                  >
                    Accept
                  </button>

                  <button
                    className="danger-button"
                    type="button"
                    onClick={() =>
                      respondToDispatch(
                        assignment.id,
                        "reject"
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
          </article>
        ))}
      </section>
    </AppLayout>
  );
}