import {
  useCallback,
  useEffect,
  useState,
} from "react";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


const initialRouteForm = {
  name: "",
  origin: "",
  destination: "",
};


const initialSpotForm = {
  route: "",
  name: "",
  latitude: "",
  longitude: "",
  geofence_radius_meters: 100,
};


function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "Location services are not supported by this browser."
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}


function extractError(error, fallbackMessage) {
  const data = error.response?.data;

  if (!data) {
    return error.message || fallbackMessage;
  }

  const firstValue = Object.values(data).flat()[0];

  return String(firstValue || fallbackMessage);
}


export default function RoutesPage() {
  const { user } = useAuth();

  const [routes, setRoutes] = useState([]);
  const [currentWaiting, setCurrentWaiting] = useState(null);

  const [routeForm, setRouteForm] = useState(initialRouteForm);
  const [spotForm, setSpotForm] = useState(initialSpotForm);

  const [loading, setLoading] = useState(true);
  const [checkingSpotId, setCheckingSpotId] = useState(null);
  const [locatingDispatcher, setLocatingDispatcher] =
    useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isPassenger = user.role === "PASSENGER";
  const isDispatcher = user.role === "DISPATCHER";


  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const routesResponse = await api.get(
          "/transport/routes/"
        );

        setRoutes(routesResponse.data);

        if (isPassenger) {
          const waitingResponse = await api.get(
            "/transport/waiting-requests/current/"
          );

          setCurrentWaiting(
            waitingResponse.data.request
          );
        } else {
          setCurrentWaiting(null);
        }
      } catch {
        setError("TaxiLink data could not be loaded.");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [isPassenger]
  );


  useEffect(() => {
    loadData();

    const refreshInterval = window.setInterval(() => {
      loadData(true);
    }, 10000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [loadData]);


  const handleRouteChange = (event) => {
    setRouteForm({
      ...routeForm,
      [event.target.name]: event.target.value,
    });
  };


  const handleSpotChange = (event) => {
    setSpotForm({
      ...spotForm,
      [event.target.name]: event.target.value,
    });
  };


  const createRoute = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await api.post(
        "/transport/routes/",
        routeForm
      );

      setRouteForm(initialRouteForm);
      setMessage("Route created successfully.");

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Route could not be created."
        )
      );
    }
  };


  const useCurrentLocationForSpot = async () => {
    setError("");
    setMessage("");
    setLocatingDispatcher(true);

    try {
      const position = await getBrowserLocation();

      setSpotForm((currentForm) => ({
        ...currentForm,
        latitude: position.coords.latitude.toFixed(6),
        longitude: position.coords.longitude.toFixed(6),
      }));

      setMessage(
        "Current coordinates added to the waiting spot form."
      );
    } catch (locationError) {
      setError(
        locationError.message
          || "Your current location could not be obtained."
      );
    } finally {
      setLocatingDispatcher(false);
    }
  };


  const createWaitingSpot = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await api.post(
        "/transport/waiting-spots/",
        spotForm
      );

      setSpotForm(initialSpotForm);
      setMessage("Waiting spot created successfully.");

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Waiting spot could not be created."
        )
      );
    }
  };


  const toggleRoute = async (route) => {
    setError("");
    setMessage("");

    try {
      await api.patch(
        `/transport/routes/${route.id}/`,
        {
          is_active: !route.is_active,
        }
      );

      await loadData(true);
    } catch {
      setError("The route status could not be changed.");
    }
  };


  const toggleWaitingSpot = async (spot) => {
    setError("");
    setMessage("");

    try {
      await api.patch(
        `/transport/waiting-spots/${spot.id}/`,
        {
          is_active: !spot.is_active,
        }
      );

      await loadData(true);
    } catch {
      setError(
        "The waiting spot status could not be changed."
      );
    }
  };


  const checkInAtSpot = async (spot) => {
    setError("");
    setMessage("");
    setCheckingSpotId(spot.id);

    try {
      const position = await getBrowserLocation();

      await api.post(
        "/transport/waiting-requests/check-in/",
        {
          waiting_spot: spot.id,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }
      );

      setMessage(
        `You are now waiting at ${spot.name}.`
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Your waiting request could not be created."
        )
      );
    } finally {
      setCheckingSpotId(null);
    }
  };


  const cancelWaitingRequest = async () => {
    setError("");
    setMessage("");

    try {
      await api.post(
        "/transport/waiting-requests/cancel/"
      );

      setCurrentWaiting(null);
      setMessage("Your waiting request was cancelled.");

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "The waiting request could not be cancelled."
        )
      );
    }
  };


  return (
    <AppLayout>
      <section className="page-heading">
        <h2>Routes and Waiting Spots</h2>

        <p>
          Demand information refreshes automatically every
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

      {isPassenger && currentWaiting && (
        <section className="current-waiting-card">
          <div>
            <span className="status-badge active">
              Currently waiting
            </span>

            <h3>{currentWaiting.waiting_spot_name}</h3>

            <p>
              Route: {currentWaiting.route_name}
            </p>

            <small>
              Location verified approximately{" "}
              {currentWaiting.distance_from_spot_meters} metres
              from the waiting spot.
            </small>
          </div>

          <button
            className="danger-button"
            type="button"
            onClick={cancelWaitingRequest}
          >
            Cancel waiting request
          </button>
        </section>
      )}

      {isDispatcher && (
        <section className="management-grid">
          <form
            className="form-card"
            onSubmit={createRoute}
          >
            <h3>Create Route</h3>

            <input
              name="name"
              placeholder="Route name"
              value={routeForm.name}
              onChange={handleRouteChange}
              required
            />

            <input
              name="origin"
              placeholder="Origin"
              value={routeForm.origin}
              onChange={handleRouteChange}
              required
            />

            <input
              name="destination"
              placeholder="Destination"
              value={routeForm.destination}
              onChange={handleRouteChange}
              required
            />

            <button type="submit">
              Create route
            </button>
          </form>

          <form
            className="form-card"
            onSubmit={createWaitingSpot}
          >
            <h3>Add Waiting Spot</h3>

            <select
              name="route"
              value={spotForm.route}
              onChange={handleSpotChange}
              required
            >
              <option value="">
                Select route
              </option>

              {routes.map((route) => (
                <option
                  key={route.id}
                  value={route.id}
                >
                  {route.name}
                </option>
              ))}
            </select>

            <input
              name="name"
              placeholder="Waiting spot name"
              value={spotForm.name}
              onChange={handleSpotChange}
              required
            />

            <button
              className="secondary-button"
              type="button"
              disabled={locatingDispatcher}
              onClick={useCurrentLocationForSpot}
            >
              {locatingDispatcher
                ? "Getting location..."
                : "Use my current location"}
            </button>

            <input
              name="latitude"
              type="number"
              step="0.000001"
              placeholder="Latitude"
              value={spotForm.latitude}
              onChange={handleSpotChange}
              required
            />

            <input
              name="longitude"
              type="number"
              step="0.000001"
              placeholder="Longitude"
              value={spotForm.longitude}
              onChange={handleSpotChange}
              required
            />

            <input
              name="geofence_radius_meters"
              type="number"
              min="20"
              max="1000"
              value={spotForm.geofence_radius_meters}
              onChange={handleSpotChange}
              required
            />

            <button type="submit">
              Add waiting spot
            </button>
          </form>
        </section>
      )}

      {loading ? (
        <div className="page-message">
          Loading routes...
        </div>
      ) : (
        <section className="list-stack">
          {routes.length === 0 && (
            <div className="route-card">
              No active routes are available.
            </div>
          )}

          {routes.map((route) => (
            <article
              className="route-card"
              key={route.id}
            >
              <div className="route-header">
                <div>
                  <h3>{route.name}</h3>

                  <p>
                    {route.origin} → {route.destination}
                  </p>
                </div>

                <div>
                  <span
                    className={
                      route.is_active
                        ? "status-badge active"
                        : "status-badge inactive"
                    }
                  >
                    {route.is_active
                      ? "Active"
                      : "Inactive"}
                  </span>

                  {isDispatcher && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        toggleRoute(route)
                      }
                    >
                      {route.is_active
                        ? "Deactivate"
                        : "Activate"}
                    </button>
                  )}
                </div>
              </div>

              <div className="spot-list">
                {route.waiting_spots.length === 0 && (
                  <p>
                    No waiting spots for this route.
                  </p>
                )}

                {route.waiting_spots.map((spot) => {
                  const waitingHere =
                    currentWaiting?.waiting_spot === spot.id;

                  return (
                    <div
                      className="spot-item"
                      key={spot.id}
                    >
                      <div>
                        <strong>{spot.name}</strong>

                        <p>
                          {spot.latitude},{" "}
                          {spot.longitude}
                        </p>

                        <small>
                          Geofence radius:{" "}
                          {spot.geofence_radius_meters} metres
                        </small>
                      </div>

                      <div className="spot-actions">
                        <span className="waiting-count">
                          {spot.active_waiting_count} waiting
                        </span>

                        <span
                          className={
                            spot.is_active
                              ? "status-badge active"
                              : "status-badge inactive"
                          }
                        >
                          {spot.is_active
                            ? "Active"
                            : "Inactive"}
                        </span>

                        {isPassenger && (
                          <button
                            className="action-button"
                            type="button"
                            disabled={
                              Boolean(currentWaiting)
                              || checkingSpotId === spot.id
                            }
                            onClick={() =>
                              checkInAtSpot(spot)
                            }
                          >
                            {waitingHere
                              ? "Waiting here"
                              : checkingSpotId === spot.id
                                ? "Checking location..."
                                : currentWaiting
                                  ? "Already checked in"
                                  : "I'm Waiting"}
                          </button>
                        )}

                        {isDispatcher && (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() =>
                              toggleWaitingSpot(spot)
                            }
                          >
                            {spot.is_active
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      )}
    </AppLayout>
  );
}