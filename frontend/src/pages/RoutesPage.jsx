
import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Link,
  useLocation,
} from "react-router-dom";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


// ============================================================
// CONSTANTS
// ============================================================

const MAX_GROUP_SIZE = 15;

const initialRouteForm = {
  name: "",
  origin: "",
  destination: "",
};


// ============================================================
// HELPERS
// ============================================================

function toList(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  return [];
}


function extractError(error, fallback) {
  const data = error?.response?.data;

  if (!data) {
    return error?.message || fallback;
  }

  if (typeof data === "string") {
    return data;
  }

  if (data.detail) {
    return String(data.detail);
  }

  if (typeof data === "object") {
    const firstValue = Object.values(data).flat()[0];

    if (firstValue !== undefined) {
      return String(firstValue);
    }
  }

  return fallback;
}


function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "Your browser does not support GPS location."
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


function passengerLabel(count) {
  const number = Number(count) || 0;

  return `${number} ${
    number === 1 ? "passenger" : "passengers"
  }`;
}


// ============================================================
// ROUTES PAGE
// ============================================================

export default function RoutesPage() {
  const { user } = useAuth();

  const location = useLocation();

  // ----------------------------------------------------------
  // USER ROLES
  // ----------------------------------------------------------

  const isPassenger = user?.role === "PASSENGER";

  const isDispatcher = user?.role === "DISPATCHER";


  // ----------------------------------------------------------
  // ROUTES
  // ----------------------------------------------------------

  const [routes, setRoutes] = useState([]);

  const [routeForm, setRouteForm] = useState(
    initialRouteForm
  );

  const [savingRoute, setSavingRoute] = useState(false);


  // ----------------------------------------------------------
  // PASSENGER WAITING REQUEST
  // ----------------------------------------------------------

  const [currentWaiting, setCurrentWaiting] =
    useState(null);

  const [partySize, setPartySize] = useState(1);

  const [checkingSpotId, setCheckingSpotId] =
    useState(null);

  const [cancellingWaiting, setCancellingWaiting] =
    useState(false);

  const [confirmingArrival, setConfirmingArrival] =
    useState(false);


  // ----------------------------------------------------------
  // PAGE STATE
  // ----------------------------------------------------------

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [message, setMessage] = useState(
    location.state?.notice || ""
  );

  const boardingCode =
    currentWaiting?.boarding_code || null;


  // ==========================================================
  // LOAD ROUTES AND WAITING SPOTS
  // ==========================================================

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const [
          routesResponse,
          spotsResponse,
        ] = await Promise.all([
          api.get("/transport/routes/"),
          api.get("/transport/waiting-spots/"),
        ]);

        const routeData = toList(
          routesResponse.data
        );

        const spotData = toList(
          spotsResponse.data
        );

        // Attach waiting spots to their routes.
        const mergedRoutes = routeData.map(
          (route) => ({
            ...route,

            waiting_spots: spotData
              .filter(
                (spot) =>
                  Number(spot.route) ===
                  Number(route.id)
              )
              .sort(
                (a, b) =>
                  Number(a.stop_order ?? 0) -
                  Number(b.stop_order ?? 0)
              ),
          })
        );

        setRoutes(mergedRoutes);

        // Only passengers have a current waiting request.
        if (isPassenger) {
          const waitingResponse = await api.get(
            "/transport/waiting-requests/current/"
          );

          const waitingData = waitingResponse.data;

          setCurrentWaiting(
            waitingData.active
              ? waitingData.request
              : null
          );
        } else {
          setCurrentWaiting(null);
        }
      } catch (requestError) {
        if (!silent) {
          setError(
            extractError(
              requestError,
              "TAXI MOVE data could not be loaded."
            )
          );
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [isPassenger]
  );


  // ==========================================================
  // AUTO REFRESH
  // ==========================================================

  useEffect(() => {
    loadData();

    const interval = window.setInterval(
      () => loadData(true),
      10000
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadData]);


  // ==========================================================
  // ROUTE FORM
  // ==========================================================

  const handleRouteChange = (event) => {
    const { name, value } = event.target;

    setRouteForm((current) => ({
      ...current,
      [name]: value,
    }));
  };


  // ==========================================================
  // CREATE ROUTE
  // ==========================================================

  const createRoute = async (event) => {
    event.preventDefault();

    if (!isDispatcher) {
      return;
    }

    setError("");
    setMessage("");
    setSavingRoute(true);

    try {
      await api.post(
        "/transport/routes/",
        {
          name: routeForm.name.trim(),
          origin: routeForm.origin.trim(),
          destination: routeForm.destination.trim(),
        }
      );

      setRouteForm(initialRouteForm);

      setMessage(
        "Route created successfully."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Route could not be created."
        )
      );
    } finally {
      setSavingRoute(false);
    }
  };


  // ==========================================================
  // ACTIVATE / DEACTIVATE ROUTE
  // ==========================================================

  const toggleRoute = async (route) => {
    if (!isDispatcher) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await api.patch(
        `/transport/routes/${route.id}/`,
        {
          is_active: !route.is_active,
        }
      );

      setMessage(
        route.is_active
          ? "Route deactivated successfully."
          : "Route activated successfully."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Route status could not be updated."
        )
      );
    }
  };


  // ==========================================================
  // ACTIVATE / DEACTIVATE WAITING SPOT
  // ==========================================================

  const toggleWaitingSpot = async (spot) => {
    if (!isDispatcher) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await api.patch(
        `/transport/waiting-spots/${spot.id}/`,
        {
          is_active: !spot.is_active,
        }
      );

      setMessage(
        spot.is_active
          ? "Waiting spot deactivated."
          : "Waiting spot activated."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Waiting spot status could not be updated."
        )
      );
    }
  };


  // ==========================================================
  // PASSENGER CHECK-IN
  // ==========================================================

  const checkInAtSpot = async (spot) => {
    if (!isPassenger) {
      return;
    }

    if (currentWaiting) {
      setError(
        "You already have an active waiting request or trip."
      );

      return;
    }

    if (checkingSpotId !== null) {
      return;
    }

    const selectedPartySize = Number(partySize);

    if (
      !Number.isInteger(selectedPartySize) ||
      selectedPartySize < 1 ||
      selectedPartySize > MAX_GROUP_SIZE
    ) {
      setError(
        "Choose a group size between 1 and 15 passengers."
      );

      return;
    }

    setError("");
    setMessage("");

    setCheckingSpotId(spot.id);

    try {
      // Request the passenger's current GPS location.
      const position = await getBrowserLocation();

      const response = await api.post(
        "/transport/waiting-requests/check-in/",
        {
          waiting_spot: spot.id,

          party_size: selectedPartySize,

          latitude:
            position.coords.latitude.toFixed(6),

          longitude:
            position.coords.longitude.toFixed(6),
        }
      );

      setCurrentWaiting(response.data);

      setMessage(
        `${passengerLabel(selectedPartySize)} checked in ` +
        `at ${spot.name}.`
      );

      setPartySize(1);

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Your group could not be checked in."
        )
      );
    } finally {
      setCheckingSpotId(null);
    }
  };


  // ==========================================================
  // CANCEL WAITING REQUEST
  // ==========================================================

  const cancelWaitingRequest = async () => {
    if (!isPassenger || !currentWaiting) {
      return;
    }

    setError("");
    setMessage("");

    setCancellingWaiting(true);

    try {
      await api.post(
        "/transport/waiting-requests/cancel/"
      );

      setCurrentWaiting(null);

      setMessage(
        "Your waiting request was cancelled."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "The waiting request could not be cancelled."
        )
      );
    } finally {
      setCancellingWaiting(false);
    }
  };


  // ==========================================================
  // CONFIRM SAFE ARRIVAL
  // ==========================================================

  const confirmSafeArrival = async () => {
    if (!isPassenger || !currentWaiting) {
      return;
    }

    setError("");
    setMessage("");

    setConfirmingArrival(true);

    try {
      await api.post(
        "/transport/waiting-requests/confirm-arrival/"
      );

      setCurrentWaiting(null);

      setMessage(
        "Safe arrival confirmed. The dispatcher has been notified."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Safe arrival could not be confirmed."
        )
      );
    } finally {
      setConfirmingArrival(false);
    }
  };


  // ==========================================================
  // PAGE INTERFACE
  // ==========================================================

  return (
    <AppLayout>

      {/* PAGE HEADING */}

      <section className="page-heading">
        <h2>Routes and Waiting Spots</h2>

        <p>
          TAXI MOVE passenger service operates
          daily from 04:00 until 17:00.
        </p>
      </section>


      {/* SUCCESS MESSAGE */}

      {message && (
        <div className="success-message">
          {message}
        </div>
      )}


      {/* ERROR MESSAGE */}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}


      {/* ================================================ */}
      {/* CURRENT PASSENGER REQUEST */}
      {/* ================================================ */}

      {isPassenger && currentWaiting && (
        <section className="current-waiting-card">

          <div>
            <span className="status-badge active">
              {currentWaiting.status_display ||
                currentWaiting.status}
            </span>

            <h3>
              {currentWaiting.waiting_spot_name}
            </h3>

            <p>
              Route: {currentWaiting.route_name}
            </p>

            <p>
              Group size:{" "}
              <strong>
                {passengerLabel(
                  currentWaiting.party_size ?? 1
                )}
              </strong>
            </p>


            {/* ASSIGNED DRIVER */}

            {currentWaiting.driver_name && (
              <p>
                Driver: {currentWaiting.driver_name}
              </p>
            )}


            {/* DISPATCH STATUS */}

            {currentWaiting.dispatch_status_display && (
              <p>
                Dispatch status:{" "}
                {currentWaiting.dispatch_status_display}
              </p>
            )}


            {/* BOARDING CODE */}

            {boardingCode &&
              currentWaiting.status !== "BOARDED" && (
                <div
                  style={{
                    padding: "16px",
                    marginTop: "12px",
                    marginBottom: "12px",
                    background: "#fff8e9",
                    border: "1px solid #d9b978",
                    borderRadius: "10px",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontWeight: 700,
                    }}
                  >
                    Your Boarding Code
                  </p>

                  <strong
                    style={{
                      display: "block",
                      fontSize: "28px",
                      letterSpacing: "5px",
                      color: "#173a55",
                    }}
                  >
                    {boardingCode}
                  </strong>

                  <small>
                    Give this code only to your assigned
                    driver when your group boards the taxi.
                  </small>
                </div>
              )}


            {/* WAITING */}

            {currentWaiting.status === "WAITING" && (
              <small>
                Location verified approximately{" "}
                {currentWaiting.distance_from_spot_meters}{" "}
                metres from the waiting spot.
              </small>
            )}


            {/* ASSIGNED */}

            {currentWaiting.status === "ASSIGNED" && (
              <small>
                A taxi has been assigned to your group.
                Keep your boarding code ready.
              </small>
            )}


            {/* BOARDED */}

            {currentWaiting.status === "BOARDED" &&
              !currentWaiting.can_confirm_arrival && (
                <small>
                  Your group has boarded.
                  The trip is in progress.
                </small>
              )}


            {/* READY FOR ARRIVAL CONFIRMATION */}

            {currentWaiting.can_confirm_arrival && (
              <small>
                The driver has completed the trip.
                Please confirm your safe arrival.
              </small>
            )}
          </div>


          {/* CANCEL BUTTON */}

          {["WAITING", "ASSIGNED"].includes(
            currentWaiting.status
          ) && (
            <button
              className="danger-button"
              type="button"
              disabled={cancellingWaiting}
              onClick={cancelWaitingRequest}
            >
              {cancellingWaiting
                ? "Cancelling..."
                : "Cancel Group Request"}
            </button>
          )}


          {/* CONFIRM ARRIVAL BUTTON */}

          {currentWaiting.can_confirm_arrival && (
            <button
              className="action-button"
              type="button"
              disabled={confirmingArrival}
              onClick={confirmSafeArrival}
            >
              {confirmingArrival
                ? "Confirming..."
                : "I've Arrived Safely"}
            </button>
          )}

        </section>
      )}


      {/* ================================================ */}
      {/* PASSENGER GROUP SIZE */}
      {/* ================================================ */}

      {isPassenger && !currentWaiting && (
        <section
          className="current-waiting-card"
          style={{
            marginBottom: "24px",
          }}
        >
          <div>
            <h3>
              How many passengers are waiting?
            </h3>

            <p>
              Select the total number of people
              travelling together, including yourself.
              One request represents your entire group.
            </p>

            <label
              htmlFor="passenger-party-size"
              style={{
                display: "block",
                marginTop: "12px",
                marginBottom: "8px",
                fontWeight: 700,
              }}
            >
              Number of passengers
            </label>

            <select
              id="passenger-party-size"
              value={partySize}
              onChange={(event) => {
                setPartySize(
                  Number(event.target.value)
                );
              }}
              disabled={checkingSpotId !== null}
              style={{
                width: "180px",
                maxWidth: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
              }}
            >
              {Array.from(
                { length: MAX_GROUP_SIZE },
                (_, index) => index + 1
              ).map((count) => (
                <option
                  key={count}
                  value={count}
                >
                  {passengerLabel(count)}
                </option>
              ))}
            </select>

            <p
              style={{
                marginTop: "10px",
              }}
            >
              Selected:{" "}
              <strong>
                {passengerLabel(partySize)}
              </strong>
            </p>
          </div>
        </section>
      )}


      {/* ================================================ */}
      {/* DISPATCHER: CREATE ROUTE */}
      {/* ================================================ */}

      {isDispatcher && (
        <section
          className="form-card"
          style={{
            maxWidth: "650px",
            marginBottom: "24px",
          }}
        >
          <form onSubmit={createRoute}>
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

            <button
              type="submit"
              disabled={savingRoute}
            >
              {savingRoute
                ? "Creating..."
                : "Create Route"}
            </button>
          </form>
        </section>
      )}


      {/* ================================================ */}
      {/* ROUTES AND WAITING SPOTS */}
      {/* ================================================ */}

      {loading ? (
        <div className="page-message">
          Loading routes...
        </div>
      ) : (
        <section className="list-stack">

          {/* EMPTY ROUTES */}

          {routes.length === 0 && (
            <div className="route-card">
              No routes are currently available.
            </div>
          )}


          {/* ROUTE CARDS */}

          {routes.map((route) => (
            <article
              className="route-card"
              key={route.id}
            >

              {/* ROUTE HEADER */}

              <div className="route-header">
                <div>
                  <h3>
                    {route.name}
                  </h3>

                  <p>
                    {route.origin} → {route.destination}
                  </p>

                  <small>
                    Passenger service: 04:00–17:00
                  </small>
                </div>

                <div>
                  <span
                    className={
                      route.service_is_open
                        ? "status-badge active"
                        : "status-badge inactive"
                    }
                  >
                    {route.service_is_open
                      ? "Service open"
                      : "Service unavailable"}
                  </span>


                  {/* ACTIVATE / DEACTIVATE ROUTE */}

                  {isDispatcher && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        toggleRoute(route);
                      }}
                    >
                      {route.is_active
                        ? "Deactivate"
                        : "Activate"}
                    </button>
                  )}
                </div>
              </div>


              {/* ======================================== */}
              {/* ADD WAITING SPOT */}
              {/* ======================================== */}

              {isDispatcher && (
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    marginBottom: "20px",
                    flexWrap: "wrap",
                  }}
                >
                  <Link
                    to={
                      `/routes/${route.id}/waiting-spots/new`
                    }
                    className="action-button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textDecoration: "none",
                    }}
                  >
                    + Add Waiting Spot
                  </Link>
                </div>
              )}


              {/* ======================================== */}
              {/* WAITING SPOTS FOR THIS ROUTE */}
              {/* ======================================== */}

              <div className="spot-list">

                {route.waiting_spots.length === 0 && (
                  <p>
                    No waiting spots have been added
                    to this route.
                  </p>
                )}


                {route.waiting_spots.map((spot) => {
                  const waitingHere =
                    Number(
                      currentWaiting?.waiting_spot
                    ) === Number(spot.id);

                  const serviceOpen =
                    Boolean(route.service_is_open) &&
                    Boolean(spot.service_is_open);

                  return (
                    <div
                      className="spot-item"
                      key={spot.id}
                    >

                      {/* SPOT INFORMATION */}

                      <div>
                        <strong>
                          {spot.name}
                        </strong>

                        <p>
                          {spot.latitude},{" "}
                          {spot.longitude}
                        </p>

                        <small>
                          Geofence radius:{" "}
                          {spot.geofence_radius_meters}{" "}
                          metres
                        </small>
                      </div>


                      {/* SPOT ACTIONS */}

                      <div className="spot-actions">

                        {/* PASSENGER DEMAND */}

                        <span className="waiting-count">
                          {passengerLabel(
                            spot.active_waiting_count
                          )}{" "}
                          waiting
                        </span>


                        {/* SPOT STATUS */}

                        <span
                          className={
                            serviceOpen
                              ? "status-badge active"
                              : "status-badge inactive"
                          }
                        >
                          {serviceOpen
                            ? "Available"
                            : "Unavailable"}
                        </span>


                        {/* CLOSED SERVICE MESSAGE */}

                        {isPassenger &&
                          !serviceOpen && (
                            <small>
                              Check-in is unavailable
                              while this service is closed.
                            </small>
                          )}


                        {/* PASSENGER CHECK-IN */}

                        {isPassenger &&
                          serviceOpen &&
                          !currentWaiting && (
                            <button
                              className="action-button"
                              type="button"
                              disabled={
                                checkingSpotId !== null
                              }
                              onClick={() => {
                                checkInAtSpot(spot);
                              }}
                            >
                              {checkingSpotId === spot.id
                                ? "Checking location..."
                                : `I'm Waiting (${passengerLabel(
                                    partySize
                                  )})`}
                            </button>
                          )}


                        {/* EXISTING PASSENGER TRIP */}

                        {isPassenger &&
                          currentWaiting && (
                            <span className="status-badge inactive">
                              {waitingHere
                                ? currentWaiting.status_display ||
                                  currentWaiting.status
                                : "Active trip"}
                            </span>
                          )}


                        {/* DISPATCHER CONTROLS */}

                        {isDispatcher && (
                          <>
                            {/* EDIT WAITING SPOT */}

                            <Link
                              to={
                                `/routes/${route.id}/waiting-spots/${spot.id}/edit`
                              }
                              className="secondary-button"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                textDecoration: "none",
                              }}
                            >
                              Edit
                            </Link>


                            {/* ACTIVATE / DEACTIVATE */}

                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => {
                                toggleWaitingSpot(spot);
                              }}
                            >
                              {spot.is_active
                                ? "Deactivate"
                                : "Activate"}
                            </button>
                          </>
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