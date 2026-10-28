
import {
  Link,
  useLocation,
} from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


const MAX_GROUP_SIZE = 15;




function toList(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return Array.isArray(data?.results)
    ? data.results
    : [];
}


function extractError(error, fallback) {
  const data = error.response?.data;

  if (!data) {
    return error.message || fallback;
  }

  if (data.detail) {
    return String(data.detail);
  }

  const value = Object.values(data).flat()[0];

  if (typeof value === "object" && value !== null) {
    return String(
      Object.values(value).flat()[0] || fallback
    );
  }

  return String(value || fallback);
}


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


function validCoordinates(latitude, longitude) {
  if (
    latitude === ""
    || longitude === ""
    || latitude == null
    || longitude == null
  ) {
    return null;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || lat < -90
    || lat > 90
    || lng < -180
    || lng > 180
  ) {
    return null;
  }

  return [lat, lng];
}


function passengerLabel(count) {
  const number = Number(count) || 0;

  return `${number} ${number === 1 ? "passenger" : "passengers"}`;
}


// ============================================================
// INTERACTIVE WAITING SPOT MAP PICKER
// ============================================================

function WaitingSpotMapPicker({
  latitude,
  longitude,
  radius,
  existingSpots,
  onSelect,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  const selectedLayerRef = useRef(null);
  const existingLayerRef = useRef(null);

  const markerRef = useRef(null);
  const circleRef = useRef(null);

  const onSelectRef = useRef(onSelect);
  const fittedRef = useRef(false);

  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([-28.5, 24.7], 5);

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">'
          + "OpenStreetMap</a> contributors",
      }
    ).addTo(map);

    const existingLayer = L.layerGroup().addTo(map);
    const selectedLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    existingLayerRef.current = existingLayer;
    selectedLayerRef.current = selectedLayer;

    map.on("click", (event) => {
      onSelectRef.current(
        event.latlng.lat.toFixed(6),
        event.latlng.lng.toFixed(6)
      );
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => map.invalidateSize())
        : null;

    resizeObserver?.observe(containerRef.current);

    const resizeTimer = window.setTimeout(
      () => map.invalidateSize(),
      100
    );

    return () => {
      window.clearTimeout(resizeTimer);
      resizeObserver?.disconnect();

      map.remove();

      mapRef.current = null;
      existingLayerRef.current = null;
      selectedLayerRef.current = null;

      markerRef.current = null;
      circleRef.current = null;
      fittedRef.current = false;
    };
  }, []);


  useEffect(() => {
    const map = mapRef.current;
    const layer = existingLayerRef.current;

    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

    const points = [];

    existingSpots.forEach((spot) => {
      const coordinates = validCoordinates(
        spot.latitude,
        spot.longitude
      );

      if (!coordinates) {
        return;
      }

      points.push(coordinates);

      const marker = L.circleMarker(coordinates, {
        radius: 6,
        color: "#976f16",
        weight: 2,
        fillColor: "#e5b344",
        fillOpacity: 0.9,
      }).addTo(layer);

      const popup = document.createElement("div");
      popup.textContent =
        `${spot.name} — ${spot.route_name || ""}`;

      marker.bindPopup(popup);
    });

    if (!fittedRef.current && points.length > 0) {
      if (points.length === 1) {
        map.setView(points[0], 14);
      } else {
        map.fitBounds(points, {
          padding: [30, 30],
          maxZoom: 14,
        });
      }

      fittedRef.current = true;
    }
  }, [existingSpots]);


  useEffect(() => {
    const map = mapRef.current;
    const layer = selectedLayerRef.current;

    if (!map || !layer) {
      return;
    }

    const coordinates = validCoordinates(
      latitude,
      longitude
    );

    if (!coordinates) {
      layer.clearLayers();

      markerRef.current = null;
      circleRef.current = null;
      return;
    }

    const geofenceRadius = Math.max(
      20,
      Math.min(1000, Number(radius) || 100)
    );

    if (!circleRef.current) {
      circleRef.current = L.circle(coordinates, {
        radius: geofenceRadius,
        color: "#1c6da4",
        weight: 2,
        fillColor: "#318ac4",
        fillOpacity: 0.16,
      }).addTo(layer);
    } else {
      circleRef.current.setLatLng(coordinates);
      circleRef.current.setRadius(geofenceRadius);
    }

    if (!markerRef.current) {
      markerRef.current = L.marker(coordinates, {
        draggable: true,
      }).addTo(layer);

      markerRef.current.on("dragend", () => {
        const position = markerRef.current.getLatLng();

        onSelectRef.current(
          position.lat.toFixed(6),
          position.lng.toFixed(6)
        );
      });
    } else {
      markerRef.current.setLatLng(coordinates);
    }

    map.panTo(coordinates);

    if (map.getZoom() < 13) {
      map.setZoom(13);
    }
  }, [latitude, longitude, radius]);


  return (
    <div>
      <div
        ref={containerRef}
        role="region"
        aria-label="Select taxi waiting spot location on map"
        style={{
          width: "100%",
          height: "350px",
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid rgba(20, 40, 65, 0.15)",
        }}
      />

      <p
        className="empty-note"
        style={{ marginTop: "10px" }}
      >
        Click the map to choose the collection point.
        Drag the marker to adjust its position.
        The blue circle shows the geofence.
      </p>
    </div>
  );
}


// ============================================================
// ROUTES PAGE
// ============================================================

export default function RoutesPage() {
  const { user } = useAuth();
  const location = useLocation();

  const [routes, setRoutes] = useState([]);
  const [currentWaiting, setCurrentWaiting] = useState(null);

  const [partySize, setPartySize] = useState(1);

  const [loading, setLoading] = useState(true);
  const [checkingSpotId, setCheckingSpotId] = useState(null);

  const [savingRoute, setSavingRoute] = useState(false);
  const [cancellingWaiting, setCancellingWaiting] = useState(false);
  const [confirmingArrival, setConfirmingArrival] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState(
    location.state?.notice || ""
  );

  const spotFormRef = useRef(null);

  const isPassenger = user?.role === "PASSENGER";
  const isDispatcher = user?.role === "DISPATCHER";

  const existingSpots = useMemo(
    () =>
      routes.flatMap(
        (route) => route.waiting_spots || []
      ),
    [routes]
  );

  const boardingCode =
    currentWaiting?.boarding_code || null;


  // ==========================================================
  // LOAD DATA
  // ==========================================================

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const [
          routesResponse,
          spotsResponse,
        ] = await Promise.all([
          api.get("/transport/routes/"),
          api.get("/transport/waiting-spots/"),
        ]);

        const routeData = toList(routesResponse.data);
        const spotData = toList(spotsResponse.data);

        const mergedRoutes = routeData.map((route) => ({
          ...route,
          waiting_spots: spotData.filter(
            (spot) =>
              Number(spot.route) === Number(route.id)
          ),
        }));

        setRoutes(mergedRoutes);

        if (isPassenger) {
          const waitingResponse = await api.get(
            "/transport/waiting-requests/current/"
          );

          setCurrentWaiting(
            waitingResponse.data.active
              ? waitingResponse.data.request
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
              "TaxiLink data could not be loaded."
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


  useEffect(() => {
    loadData();

    const interval = window.setInterval(
      () => loadData(true),
      10000
    );

    return () => window.clearInterval(interval);
  }, [loadData]);


  // ==========================================================
  // ROUTE FORM
  // ==========================================================

  const handleRouteChange = (event) => {
    setRouteForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };


  const createRoute = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");
    setSavingRoute(true);

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
    } finally {
      setSavingRoute(false);
    }
  };


  // ==========================================================
  // WAITING SPOT FORM
  // ==========================================================

  const handleSpotChange = (event) => {
    setSpotForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };


  const selectMapLocation = useCallback(
    (latitude, longitude) => {
      setSpotForm((current) => ({
        ...current,
        latitude,
        longitude,
      }));
    },
    []
  );


  const useCurrentLocationForSpot = async () => {
    setError("");
    setMessage("");
    setLocatingDispatcher(true);

    try {
      const position = await getBrowserLocation();

      selectMapLocation(
        position.coords.latitude.toFixed(6),
        position.coords.longitude.toFixed(6)
      );

      setMessage(
        "Your current location was selected on the map."
      );
    } catch (locationError) {
      setError(
        locationError.message
        || "Your location could not be obtained."
      );
    } finally {
      setLocatingDispatcher(false);
    }
  };


  const saveWaitingSpot = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!validCoordinates(
      spotForm.latitude,
      spotForm.longitude
    )) {
      setError(
        "Please select a valid waiting spot on the map."
      );
      return;
    }

    const radius = Number(
      spotForm.geofence_radius_meters
    );

    if (
      !Number.isInteger(radius)
      || radius < 20
      || radius > 1000
    ) {
      setError(
        "The geofence radius must be between "
        + "20 and 1000 metres."
      );
      return;
    }

    const payload = {
      route: Number(spotForm.route),
      name: spotForm.name.trim(),
      latitude: spotForm.latitude,
      longitude: spotForm.longitude,
      geofence_radius_meters: radius,
    };

    setSavingSpot(true);

    try {
      if (editingSpotId) {
        await api.patch(
          `/transport/waiting-spots/${editingSpotId}/`,
          payload
        );

        setMessage(
          "Waiting spot updated successfully."
        );
      } else {
        await api.post(
          "/transport/waiting-spots/",
          payload
        );

        setMessage(
          "Waiting spot created successfully."
        );
      }

      setSpotForm(initialSpotForm);
      setEditingSpotId(null);

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Waiting spot could not be saved."
        )
      );
    } finally {
      setSavingSpot(false);
    }
  };


  const startEditingSpot = (spot) => {
    setError("");
    setMessage("");

    setEditingSpotId(spot.id);

    setSpotForm({
      route: String(spot.route),
      name: spot.name,
      latitude: String(spot.latitude),
      longitude: String(spot.longitude),
      geofence_radius_meters:
        spot.geofence_radius_meters,
    });

    spotFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };


  const cancelSpotEditing = () => {
    setEditingSpotId(null);
    setSpotForm(initialSpotForm);
  };


  // ==========================================================
  // ROUTE AND WAITING SPOT STATUS
  // ==========================================================

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

      setMessage(
        route.is_active
          ? "Route deactivated."
          : "Route activated."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Route status could not be changed."
        )
      );
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
          "Waiting spot status could not be changed."
        )
      );
    }
  };


  // ==========================================================
  // PASSENGER GROUP CHECK-IN
  // ==========================================================

  const checkInAtSpot = async (spot) => {
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
      !Number.isInteger(selectedPartySize)
      || selectedPartySize < 1
      || selectedPartySize > MAX_GROUP_SIZE
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
        `${passengerLabel(selectedPartySize)} checked in `
        + `at ${spot.name}.`
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
    setError("");
    setMessage("");
    setConfirmingArrival(true);

    try {
      await api.post(
        "/transport/waiting-requests/confirm-arrival/"
      );

      setCurrentWaiting(null);

      setMessage(
        "Safe arrival confirmed. "
        + "The dispatcher has been notified."
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
  // PAGE
  // ==========================================================

  return (
    <AppLayout>
      <section className="page-heading">
        <h2>Routes and Waiting Spots</h2>

        <p>
          Passenger service operates from
          04:00 until 17:00.
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

      {/* CURRENT PASSENGER REQUEST */}

      {isPassenger && currentWaiting && (
        <section className="current-waiting-card">
          <div>
            <span className="status-badge active">
              {currentWaiting.status_display}
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

            {currentWaiting.driver_name && (
              <p>
                Driver: {currentWaiting.driver_name}
              </p>
            )}

            {currentWaiting.dispatch_status_display && (
              <p>
                Dispatch status:{" "}
                {currentWaiting.dispatch_status_display}
              </p>
            )}

            {boardingCode
              && currentWaiting.status !== "BOARDED"
              && (
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

            {currentWaiting.status === "WAITING" && (
              <small>
                Location verified approximately{" "}
                {currentWaiting.distance_from_spot_meters}{" "}
                metres from the waiting spot.
              </small>
            )}

            {currentWaiting.status === "ASSIGNED" && (
              <small>
                A taxi has been assigned to your group.
                Keep your boarding code ready.
              </small>
            )}

            {currentWaiting.status === "BOARDED"
              && !currentWaiting.can_confirm_arrival
              && (
                <small>
                  Your group has boarded.
                  The trip is in progress.
                </small>
              )}

            {currentWaiting.can_confirm_arrival && (
              <small>
                The driver has completed the trip.
                Please confirm your safe arrival.
              </small>
            )}
          </div>

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

      {/* PASSENGER GROUP SIZE */}

      {isPassenger && !currentWaiting && (
        <section
          className="current-waiting-card"
          style={{ marginBottom: "24px" }}
        >
          <div>
            <h3>How many passengers are waiting?</h3>

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
              onChange={(event) =>
                setPartySize(Number(event.target.value))
              }
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
                <option key={count} value={count}>
                  {passengerLabel(count)}
                </option>
              ))}
            </select>

            <p style={{ marginTop: "10px" }}>
              Selected:{" "}
              <strong>
                {passengerLabel(partySize)}
              </strong>
            </p>
          </div>
        </section>
      )}

      {/* DISPATCHER MANAGEMENT */}

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
      

      {/* ROUTES AND WAITING SPOTS */}

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

                  {isDispatcher && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => toggleRoute(route)}
                    >
                      {route.is_active
                        ? "Deactivate"
                        : "Activate"}
                    </button>
                  )}
                </div>
              </div>
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
        "/routes/" +
        route.id +
        "/waiting-spots/new"
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

              <div className="spot-list">
                {route.waiting_spots.length === 0 && (
                  <p>
                    No waiting spots are currently
                    available for this route.
                  </p>
                )}

                {route.waiting_spots.map((spot) => {
                  const waitingHere = (
                    Number(currentWaiting?.waiting_spot)
                    === Number(spot.id)
                  );

                  const serviceOpen = (
                    route.service_is_open
                    && spot.service_is_open
                  );

                  return (
                    <div
                      className="spot-item"
                      key={spot.id}
                    >
                      <div>
                        <strong>
                          {spot.name}
                        </strong>

                        <p>
                          {spot.latitude}, {spot.longitude}
                        </p>

                        <small>
                          Geofence radius:{" "}
                          {spot.geofence_radius_meters} metres
                        </small>
                      </div>

                      <div className="spot-actions">
                        <span className="waiting-count">
                          {passengerLabel(
                            spot.active_waiting_count
                          )}{" "}
                          waiting
                        </span>

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

                        {isPassenger && !serviceOpen && (
                          <small>
                            Check-in unavailable
                            from 17:00 until 04:00.
                          </small>
                        )}

                        {isPassenger
                          && serviceOpen
                          && !currentWaiting
                          && (
                            <button
                              className="action-button"
                              type="button"
                              disabled={
                                checkingSpotId !== null
                              }
                              onClick={() =>
                                checkInAtSpot(spot)
                              }
                            >
                              {checkingSpotId === spot.id
                                ? "Checking location..."
                                : `I'm Waiting (${passengerLabel(partySize)})`}
                            </button>
                          )}

                        {isPassenger
                          && serviceOpen
                          && currentWaiting
                          && (
                            <span className="status-badge inactive">
                              {waitingHere
                                ? currentWaiting.status_display
                                : "Active trip"}
                            </span>
                          )}

                        {isDispatcher && (
                          <>
                            <Link
  to={
    "/routes/" +
    route.id +
    "/waiting-spots/" +
    spot.id +
    "/edit"
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