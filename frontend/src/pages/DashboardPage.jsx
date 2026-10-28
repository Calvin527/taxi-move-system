
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Link } from "react-router-dom";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";


const DASHBOARD_REFRESH_MS = 5000;

const ACTIVE_DISPATCH_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
];

const TRACKING_STATUSES = [
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
];


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

  const firstValue = Object.values(data).flat()[0];

  return String(firstValue || fallback);
}


function taxiServiceIsOpen() {
  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Africa/Johannesburg",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }
  ).formatToParts(new Date());

  const hour = Number(
    parts.find((part) => part.type === "hour")?.value
  );

  const minute = Number(
    parts.find((part) => part.type === "minute")?.value
  );

  if (
    !Number.isFinite(hour)
    || !Number.isFinite(minute)
  ) {
    return false;
  }

  const currentMinutes = hour * 60 + minute;

  return (
    currentMinutes >= 4 * 60
    && currentMinutes < 17 * 60
  );
}


function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString();
}


function validCoordinates(latitude, longitude) {
  if (
    latitude == null
    || longitude == null
    || latitude === ""
    || longitude === ""
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


function isStaleLocation(location) {
  if (!location?.recorded_at) {
    return true;
  }

  const recorded = new Date(
    location.recorded_at
  ).getTime();

  return (
    !Number.isFinite(recorded)
    || location.is_stale === true
    || Date.now() - recorded > 90000
  );
}


function createPopup(title, rows) {
  const container = document.createElement("div");

  const heading = document.createElement("strong");
  heading.textContent = title;

  container.appendChild(heading);

  rows.forEach((row) => {
    const line = document.createElement("div");

    line.textContent = row;
    line.style.marginTop = "5px";

    container.appendChild(line);
  });

  return container;
}


function fitMapToPoints(map, points) {
  if (!map || points.length === 0) {
    return;
  }

  if (points.length === 1) {
    map.setView(points[0], 14);
    return;
  }

  map.fitBounds(points, {
    padding: [30, 30],
    maxZoom: 14,
  });
}


// ============================================================
// DISPATCHER LIVE MAP
// ============================================================

function DriverMonitoringMap({
  waitingSpots,
  driverLocations,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const fittedRef = useRef(false);
  const pointsRef = useRef([]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView([0, 0], 2);

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">'
          + "OpenStreetMap</a> contributors",
      }
    ).addTo(map);

    const layers = L.layerGroup().addTo(map);

    mapRef.current = map;
    layersRef.current = layers;

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
      layersRef.current = null;
      fittedRef.current = false;
      pointsRef.current = [];
    };
  }, []);


  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;

    if (!map || !layers) {
      return;
    }

    layers.clearLayers();

    const points = [];

    // Dispatcher-created waiting spots and geofences.
    waitingSpots
      .filter((spot) => spot.is_active)
      .forEach((spot) => {
        const coordinates = validCoordinates(
          spot.latitude,
          spot.longitude
        );

        if (!coordinates) {
          return;
        }

        points.push(coordinates);

        const radius = Number(
          spot.geofence_radius_meters
        );

        if (Number.isFinite(radius) && radius > 0) {
          L.circle(coordinates, {
            radius,
            color: "#c99523",
            weight: 2,
            fillColor: "#e1b24e",
            fillOpacity: 0.13,
          }).addTo(layers);
        }

        L.circleMarker(coordinates, {
          radius: 7,
          color: "#956d16",
          weight: 2,
          fillColor: "#f0bd42",
          fillOpacity: 1,
        })
          .bindPopup(
            createPopup(spot.name, [
              `Route: ${spot.route_name}`,
              `Geofence: ${spot.geofence_radius_meters} m`,
              `Waiting: ${spot.active_waiting_count}`,
            ])
          )
          .addTo(layers);
      });

    // Active drivers' latest reported coordinates.
    driverLocations.forEach((location) => {
      const coordinates = validCoordinates(
        location.latitude,
        location.longitude
      );

      if (!coordinates) {
        return;
      }

      points.push(coordinates);

      const stale = isStaleLocation(location);

      L.circleMarker(coordinates, {
        radius: 10,
        color: stale ? "#667085" : "#106b4d",
        weight: 3,
        fillColor: stale ? "#98a2b3" : "#21b47d",
        fillOpacity: 0.95,
      })
        .bindPopup(
          createPopup(
            location.driver_name
              || location.driver_username,
            [
              `Pickup: ${location.waiting_spot_name}`,
              stale ? "GPS: Stale" : "GPS: Recent",
              `Updated: ${formatDate(location.recorded_at)}`,
              location.accuracy_meters != null
                ? `Accuracy: ${Math.round(Number(location.accuracy_meters))} m`
                : "Accuracy unavailable",
            ]
          )
        )
        .addTo(layers);
    });

    pointsRef.current = points;

    // Fit on first data load only, so regular refreshes
    // do not interrupt dispatcher map navigation.
    if (!fittedRef.current && points.length > 0) {
      fitMapToPoints(map, points);
      fittedRef.current = true;
    }
  }, [waitingSpots, driverLocations]);


  const fitAllLocations = () => {
    fitMapToPoints(
      mapRef.current,
      pointsRef.current
    );
  };


  return (
    <div>
      <div
        ref={containerRef}
        role="region"
        aria-label="Dispatcher live driver monitoring map"
        style={{
          height: "420px",
          width: "100%",
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid rgba(20, 40, 65, 0.12)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginTop: "14px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "16px",
            fontSize: "13px",
          }}
        >
          <span>🟢 Recent driver GPS</span>
          <span>⚪ Stale driver GPS</span>
          <span>🟡 Waiting spot / geofence</span>
        </div>

        <button
          className="action-button"
          type="button"
          onClick={fitAllLocations}
          disabled={pointsRef.current.length === 0}
        >
          Fit All Locations
        </button>
      </div>
    </div>
  );
}


// ============================================================
// PASSENGER DASHBOARD
// ============================================================

function PassengerDashboard({
  passengerRequest,
  serviceOpen,
  confirmingArrival,
  confirmSafeArrival,
}) {
  return (
    <>
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">
            Passenger overview
          </span>

          <h2>Welcome to TaxiLink</h2>

          <p>
            Request transport, monitor your taxi status,
            and confirm when you arrive safely.
          </p>
        </div>

        <div
          className={
            serviceOpen
              ? "service-indicator open"
              : "service-indicator closed"
          }
        >
          <span className="service-dot" />

          <div>
            <strong>
              {serviceOpen
                ? "Passenger service is open"
                : "Passenger service is closed"}
            </strong>

            <small>
              Operating hours: 04:00–17:00
            </small>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Current request
            </span>

            <span className="stat-icon">
              WR
            </span>
          </div>

          <strong className="stat-value stat-value-text">
            {passengerRequest
              ? passengerRequest.status_display
              : "No active request"}
          </strong>

          <p>
            {passengerRequest
              ? passengerRequest.waiting_spot_name
              : "You are not currently waiting for a taxi."}
          </p>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Taxi status
            </span>

            <span className="stat-icon">
              TX
            </span>
          </div>

          <strong className="stat-value stat-value-text">
            {passengerRequest?.dispatch_status_display
              || "Not assigned"}
          </strong>

          <p>
            {passengerRequest?.driver_name
              ? `Driver: ${passengerRequest.driver_name}`
              : "A driver will appear here once dispatched."}
          </p>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Service status
            </span>

            <span className="stat-icon">
              SH
            </span>
          </div>

          <strong className="stat-value stat-value-text">
            {serviceOpen ? "Open" : "Unavailable"}
          </strong>

          <p>
            New waiting requests are accepted
            between 04:00 and 17:00.
          </p>
        </article>
      </section>

      <section className="dashboard-content-grid">
        <article className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Trip information
              </span>

              <h3>Current Journey</h3>
            </div>

            {passengerRequest && (
              <span className="dashboard-status active">
                {passengerRequest.status_display}
              </span>
            )}
          </div>

          {!passengerRequest ? (
            <div className="empty-state">
              <h4>No active journey</h4>

              <p>
                Visit Routes and select an available
                waiting spot when you need transport.
              </p>

              {serviceOpen ? (
                <Link
                  className="dashboard-primary-link"
                  to="/routes"
                >
                  View available routes
                </Link>
              ) : (
                <span className="dashboard-disabled-link">
                  Service resumes at 04:00
                </span>
              )}
            </div>
          ) : (
            <div className="journey-details">
              <div className="detail-row">
                <span>Route</span>

                <strong>
                  {passengerRequest.route_name}
                </strong>
              </div>

              <div className="detail-row">
                <span>Waiting spot</span>

                <strong>
                  {passengerRequest.waiting_spot_name}
                </strong>
              </div>

              <div className="detail-row">
                <span>Driver</span>

                <strong>
                  {passengerRequest.driver_name
                    || "Not assigned yet"}
                </strong>
              </div>

              <div className="detail-row">
                <span>Dispatch status</span>

                <strong>
                  {passengerRequest.dispatch_status_display
                    || "Waiting for dispatcher"}
                </strong>
              </div>

              <div className="detail-row">
                <span>Requested</span>

                <strong>
                  {formatDate(
                    passengerRequest.checked_in_at
                  )}
                </strong>
              </div>

              {passengerRequest.can_confirm_arrival && (
                <div className="safe-arrival-box">
                  <div>
                    <h4>
                      Did you arrive safely?
                    </h4>

                    <p>
                      The driver completed the trip.
                      Confirm your safe arrival to
                      notify the dispatcher.
                    </p>
                  </div>

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
                </div>
              )}
            </div>
          )}
        </article>

        <article className="dashboard-panel quick-actions-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Quick access
              </span>

              <h3>Passenger Actions</h3>
            </div>
          </div>

          <Link
            className="quick-action"
            to="/routes"
          >
            <div>
              <strong>Routes & Waiting Spots</strong>

              <span>
                Find a route and request transport.
              </span>
            </div>

            <span className="quick-arrow">→</span>
          </Link>

          <Link
            className="quick-action"
            to="/profile"
          >
            <div>
              <strong>My Profile</strong>

              <span>
                Review your passenger account information.
              </span>
            </div>

            <span className="quick-arrow">→</span>
          </Link>
        </article>
      </section>
    </>
  );
}


// ============================================================
// DRIVER DASHBOARD
// ============================================================

function DriverDashboard({
  serviceOpen,
  availability,
  dispatches,
}) {
  const activeDispatch = dispatches.find(
    (dispatch) =>
      ACTIVE_DISPATCH_STATUSES.includes(
        dispatch.status
      )
  );

  const completedCount = dispatches.filter(
    (dispatch) =>
      dispatch.status === "COMPLETED"
  ).length;

  const rejectedCount = dispatches.filter(
    (dispatch) =>
      dispatch.status === "REJECTED"
  ).length;

  return (
    <>
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">
            Driver overview
          </span>

          <h2>Driver Dashboard</h2>

          <p>
            Review assignments and navigate to
            designated taxi waiting spots.
          </p>
        </div>

        <div
          className={
            serviceOpen
              ? "service-indicator open"
              : "service-indicator closed"
          }
        >
          <span className="service-dot" />

          <div>
            <strong>
              {serviceOpen
                ? "Dispatch service is open"
                : "Dispatch service is closed"}
            </strong>

            <small>
              Operating hours: 04:00–17:00
            </small>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Availability
            </span>

            <span className="stat-icon">
              AV
            </span>
          </div>

          <strong className="stat-value stat-value-text">
            {!serviceOpen
              ? "Unavailable"
              : availability?.is_available
                ? "Available"
                : "Unavailable"}
          </strong>

          <p>
            {!serviceOpen
              ? "New assignments resume at 04:00."
              : availability?.is_available
                ? "You can receive new assignments."
                : "You are not accepting new assignments."}
          </p>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Active dispatch
            </span>

            <span className="stat-icon">
              AD
            </span>
          </div>

          <strong className="stat-value">
            {activeDispatch ? "1" : "0"}
          </strong>

          <p>
            {activeDispatch
              ? `${activeDispatch.waiting_spot_name} · ${activeDispatch.status_display}`
              : "No active assignment."}
          </p>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Completed trips
            </span>

            <span className="stat-icon">
              CT
            </span>
          </div>

          <strong className="stat-value">
            {completedCount}
          </strong>

          <p>
            {rejectedCount} rejected assignment(s).
          </p>
        </article>
      </section>

      <section className="dashboard-content-grid">
        <article className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Current work
              </span>

              <h3>Active Assignment</h3>
            </div>

            {activeDispatch && (
              <span
                className={
                  `dispatch-status ${
                    activeDispatch.status.toLowerCase()
                  }`
                }
              >
                {activeDispatch.status_display}
              </span>
            )}
          </div>

          {!activeDispatch ? (
            <div className="empty-state">
              <h4>No active dispatch</h4>

              <Link
                className="dashboard-primary-link"
                to="/dispatch"
              >
                Open dispatch page
              </Link>
            </div>
          ) : (
            <div className="journey-details">
              <div className="detail-row">
                <span>Waiting spot</span>

                <strong>
                  {activeDispatch.waiting_spot_name}
                </strong>
              </div>

              <div className="detail-row">
                <span>Route</span>

                <strong>
                  {activeDispatch.route_name}
                </strong>
              </div>

              <div className="detail-row">
                <span>Passengers</span>

                <strong>
                  {activeDispatch.passenger_count}
                </strong>
              </div>

              <div className="detail-row">
                <span>Status</span>

                <strong>
                  {activeDispatch.status_display}
                </strong>
              </div>

              <div className="detail-row">
                <span>Created</span>

                <strong>
                  {formatDate(activeDispatch.created_at)}
                </strong>
              </div>

              <Link
                className="dashboard-primary-link"
                to="/dispatch"
              >
                Continue dispatch
              </Link>
            </div>
          )}
        </article>

        <article className="dashboard-panel quick-actions-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Quick access
              </span>

              <h3>Driver Actions</h3>
            </div>
          </div>

          <Link
            className="quick-action"
            to="/dispatch"
          >
            <div>
              <strong>Dispatch Management</strong>

              <span>
                Accept jobs, navigate to saved waiting
                spots and update trip progress.
              </span>
            </div>

            <span className="quick-arrow">→</span>
          </Link>

          <Link
            className="quick-action"
            to="/routes"
          >
            <div>
              <strong>Routes</strong>

              <span>
                View TaxiLink routes and waiting spots.
              </span>
            </div>

            <span className="quick-arrow">→</span>
          </Link>

          <Link
            className="quick-action"
            to="/profile"
          >
            <div>
              <strong>Profile</strong>

              <span>
                Review your driver account details.
              </span>
            </div>

            <span className="quick-arrow">→</span>
          </Link>
        </article>
      </section>
    </>
  );
}


// ============================================================
// DISPATCHER DASHBOARD
// ============================================================

function DispatcherDashboard({
  serviceOpen,
  waitingSpots,
  availableDrivers,
  dispatches,
  arrivalConfirmations,
  driverLocations,
  locationError,
}) {
  const totalWaiting = waitingSpots.reduce(
    (total, spot) =>
      total + Number(
        spot.active_waiting_count || 0
      ),
    0
  );

  const activeDispatches = dispatches.filter(
    (dispatch) =>
      ACTIVE_DISPATCH_STATUSES.includes(
        dispatch.status
      )
  );

  const trackedDispatches = dispatches.filter(
    (dispatch) =>
      TRACKING_STATUSES.includes(
        dispatch.status
      )
  );

  const completedDispatches = dispatches.filter(
    (dispatch) =>
      dispatch.status === "COMPLETED"
  );

  const demandSpots = waitingSpots
    .filter(
      (spot) =>
        Number(spot.active_waiting_count || 0) > 0
    )
    .sort(
      (a, b) =>
        Number(b.active_waiting_count)
        - Number(a.active_waiting_count)
    );

  const locationsByDispatch = new Map(
    driverLocations.map(
      (location) => [
        Number(location.dispatch_id),
        location,
      ]
    )
  );

  const recentlyReporting = driverLocations.filter(
    (location) => !isStaleLocation(location)
  ).length;


  return (
    <>
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">
            Operations overview
          </span>

          <h2>Dispatcher Dashboard</h2>

          <p>
            Monitor passenger demand, manage dispatches
            and view active driver locations.
          </p>
        </div>

        <div
          className={
            serviceOpen
              ? "service-indicator open"
              : "service-indicator closed"
          }
        >
          <span className="service-dot" />

          <div>
            <strong>
              {serviceOpen
                ? "TaxiLink service is open"
                : "TaxiLink service is closed"}
            </strong>

            <small>
              Operating hours: 04:00–17:00
            </small>
          </div>
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid-four">
        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Passengers waiting
            </span>

            <span className="stat-icon">
              PW
            </span>
          </div>

          <strong className="stat-value">
            {totalWaiting}
          </strong>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Available drivers
            </span>

            <span className="stat-icon">
              DR
            </span>
          </div>

          <strong className="stat-value">
            {availableDrivers.length}
          </strong>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Active dispatches
            </span>

            <span className="stat-icon">
              AD
            </span>
          </div>

          <strong className="stat-value">
            {activeDispatches.length}
          </strong>
        </article>

        <article className="dashboard-stat-card">
          <div className="stat-card-top">
            <span className="stat-label">
              Completed
            </span>

            <span className="stat-icon">
              CP
            </span>
          </div>

          <strong className="stat-value">
            {completedDispatches.length}
          </strong>
        </article>
      </section>

      {/* LIVE DRIVER MONITORING */}

      <section
        className="dashboard-panel"
        style={{ marginBottom: "24px" }}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              GPS operations
            </span>

            <h3>Live Driver Monitoring</h3>

            <p>
              {recentlyReporting} driver(s) reporting
              recent GPS positions.
            </p>
          </div>

          <span className="dashboard-status active">
            Dispatcher only
          </span>
        </div>

        {locationError && (
          <div className="error-message">
            Driver GPS information is unavailable:{" "}
            {locationError}
          </div>
        )}

        <DriverMonitoringMap
          waitingSpots={waitingSpots}
          driverLocations={driverLocations}
        />

        <div style={{ marginTop: "22px" }}>
          <h4>Active Driver Assignments</h4>

          {trackedDispatches.length === 0 ? (
            <div className="empty-state compact">
              <h4>No drivers currently being tracked</h4>

              <p>
                Drivers will appear here after
                accepting a dispatch assignment.
              </p>
            </div>
          ) : (
            <div className="demand-list">
              {trackedDispatches.map((dispatch) => {
                const location = locationsByDispatch.get(
                  Number(dispatch.id)
                );

                const stale = location
                  ? isStaleLocation(location)
                  : true;

                return (
                  <div
                    className="demand-item"
                    key={dispatch.id}
                  >
                    <div>
                      <strong>
                        {dispatch.driver_name}
                      </strong>

                      <span>
                        {dispatch.waiting_spot_name}
                      </span>

                      <small>
                        {dispatch.status_display}
                        {" · "}
                        {location
                          ? `GPS ${stale ? "stale" : "recent"}`
                          : "Awaiting GPS"}
                      </small>

                      {location && (
                        <small>
                          Last position:{" "}
                          {formatDate(
                            location.recorded_at
                          )}
                        </small>
                      )}
                    </div>

                    <span
                      className={
                        !stale
                          ? "status-badge active"
                          : "status-badge inactive"
                      }
                    >
                      {!location
                        ? "No GPS"
                        : stale
                          ? "Stale"
                          : "Reporting"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* DEMAND + SAFE ARRIVALS */}

      <section className="dispatcher-dashboard-grid">
        <article className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Live demand
              </span>

              <h3>Waiting Spot Demand</h3>
            </div>

            <Link
              className="panel-link"
              to="/routes"
            >
              View routes
            </Link>
          </div>

          {demandSpots.length === 0 ? (
            <div className="empty-state compact">
              <h4>
                No passengers currently waiting
              </h4>
            </div>
          ) : (
            <div className="demand-list">
              {demandSpots.slice(0, 6).map((spot) => (
                <div
                  className="demand-item"
                  key={spot.id}
                >
                  <div>
                    <strong>
                      {spot.name}
                    </strong>

                    <span>
                      {spot.route_name}
                    </span>
                  </div>

                  <span className="waiting-count">
                    {spot.active_waiting_count} waiting
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                Passenger safety
              </span>

              <h3>Safe Arrival Confirmations</h3>
            </div>
          </div>

          {arrivalConfirmations.length === 0 ? (
            <div className="empty-state compact">
              <h4>No confirmations yet</h4>
            </div>
          ) : (
            <div className="arrival-list">
              {arrivalConfirmations
                .slice(0, 5)
                .map((confirmation) => (
                  <div
                    className="arrival-item"
                    key={confirmation.id}
                  >
                    <div className="arrival-check">
                      ✓
                    </div>

                    <div>
                      <strong>
                        {confirmation.passenger_username}
                      </strong>

                      <span>
                        Arrived safely ·{" "}
                        {confirmation.route_name}
                      </span>

                      <small>
                        {formatDate(
                          confirmation.arrival_confirmed_at
                        )}
                      </small>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </article>
      </section>

      {/* RECENT DISPATCH ACTIVITY */}

      <section className="dashboard-panel dashboard-recent">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              Operations
            </span>

            <h3>Recent Dispatch Activity</h3>
          </div>

          <Link
            className="panel-link"
            to="/dispatch"
          >
            Manage dispatches
          </Link>
        </div>

        {dispatches.length === 0 ? (
          <div className="empty-state compact">
            <h4>No dispatch activity yet</h4>
          </div>
        ) : (
          <div className="dashboard-table-wrapper">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Waiting spot</th>
                  <th>Driver</th>
                  <th>Passengers</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>

              <tbody>
                {dispatches.slice(0, 8).map((dispatch) => (
                  <tr key={dispatch.id}>
                    <td>
                      <strong>
                        {dispatch.waiting_spot_name}
                      </strong>

                      <small>
                        {dispatch.route_name}
                      </small>
                    </td>

                    <td>
                      {dispatch.driver_name}
                    </td>

                    <td>
                      {dispatch.passenger_count}
                    </td>

                    <td>
                      <span
                        className={
                          `dispatch-status ${
                            dispatch.status.toLowerCase()
                          }`
                        }
                      >
                        {dispatch.status_display}
                      </span>
                    </td>

                    <td>
                      {formatDate(dispatch.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}


// ============================================================
// MAIN DASHBOARD PAGE
// ============================================================

export default function DashboardPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [passengerRequest, setPassengerRequest] =
    useState(null);

  const [driverAvailability, setDriverAvailability] =
    useState(null);

  const [dispatches, setDispatches] =
    useState([]);

  const [waitingSpots, setWaitingSpots] =
    useState([]);

  const [availableDrivers, setAvailableDrivers] =
    useState([]);

  const [arrivalConfirmations, setArrivalConfirmations] =
    useState([]);

  const [driverLocations, setDriverLocations] =
    useState([]);

  const [locationError, setLocationError] =
    useState("");

  const [confirmingArrival, setConfirmingArrival] =
    useState(false);

  const [serviceOpen, setServiceOpen] =
    useState(taxiServiceIsOpen());

  const arrivalInitialized = useRef(false);
  const latestArrivalId = useRef(null);

  const isPassenger = user?.role === "PASSENGER";
  const isDriver = user?.role === "DRIVER";
  const isDispatcher = user?.role === "DISPATCHER";


  const loadDashboard = useCallback(
    async (silent = false) => {
      setServiceOpen(taxiServiceIsOpen());

      if (!silent) {
        setLoading(true);
      }

      try {
        if (isPassenger) {
          const response = await api.get(
            "/transport/waiting-requests/current/"
          );

          setPassengerRequest(
            response.data.active
              ? response.data.request
              : null
          );
        }

        if (isDriver) {
          const [
            availabilityResponse,
            dispatchResponse,
          ] = await Promise.all([
            api.get(
              "/transport/drivers/availability/"
            ),
            api.get(
              "/transport/dispatches/"
            ),
          ]);

          setDriverAvailability(
            availabilityResponse.data
          );

          setDispatches(
            toList(dispatchResponse.data)
          );
        }

        if (isDispatcher) {
          const trackingRequest = api.get(
            "/transport/dispatches/live-locations/"
          )
            .then((response) => ({
              data: toList(response.data),
              error: "",
            }))
            .catch((requestError) => ({
              data: [],
              error: extractError(
                requestError,
                "Driver monitoring could not be loaded."
              ),
            }));

          const [
            spotsResponse,
            driversResponse,
            dispatchResponse,
            arrivalsResponse,
            trackingResult,
          ] = await Promise.all([
            api.get(
              "/transport/waiting-spots/"
            ),
            api.get(
              "/transport/drivers/available/"
            ),
            api.get(
              "/transport/dispatches/"
            ),
            api.get(
              "/transport/waiting-requests/arrival-confirmations/"
            ),
            trackingRequest,
          ]);

          setWaitingSpots(
            toList(spotsResponse.data)
          );

          setAvailableDrivers(
            toList(driversResponse.data)
          );

          setDispatches(
            toList(dispatchResponse.data)
          );

          setDriverLocations(
            trackingResult.data
          );

          setLocationError(
            trackingResult.error
          );

          const arrivals = toList(
            arrivalsResponse.data
          );

          setArrivalConfirmations(arrivals);

          const newestArrival = arrivals[0] || null;

          if (!arrivalInitialized.current) {
            latestArrivalId.current =
              newestArrival?.id || null;

            arrivalInitialized.current = true;
          } else if (
            newestArrival
            && newestArrival.id !== latestArrivalId.current
          ) {
            latestArrivalId.current = newestArrival.id;

            setMessage(
              `Passenger ${newestArrival.passenger_username} `
              + `confirmed safe arrival on `
              + `${newestArrival.route_name}.`
            );
          }
        }
      } catch (requestError) {
        if (!silent) {
          setError(
            extractError(
              requestError,
              "Dashboard information could not be loaded."
            )
          );
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [
      isPassenger,
      isDriver,
      isDispatcher,
    ]
  );


  useEffect(() => {
    loadDashboard();

    const intervalId = window.setInterval(
      () => loadDashboard(true),
      DASHBOARD_REFRESH_MS
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadDashboard]);


  const confirmSafeArrival = async () => {
    setError("");
    setMessage("");
    setConfirmingArrival(true);

    try {
      await api.post(
        "/transport/waiting-requests/confirm-arrival/"
      );

      setPassengerRequest(null);

      setMessage(
        "Safe arrival confirmed. "
        + "The dispatcher has been notified."
      );

      await loadDashboard(true);
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


  let dashboard = null;

  if (isPassenger) {
    dashboard = (
      <PassengerDashboard
        passengerRequest={passengerRequest}
        serviceOpen={serviceOpen}
        confirmingArrival={confirmingArrival}
        confirmSafeArrival={confirmSafeArrival}
      />
    );
  } else if (isDriver) {
    dashboard = (
      <DriverDashboard
        serviceOpen={serviceOpen}
        availability={driverAvailability}
        dispatches={dispatches}
      />
    );
  } else if (isDispatcher) {
    dashboard = (
      <DispatcherDashboard
        serviceOpen={serviceOpen}
        waitingSpots={waitingSpots}
        availableDrivers={availableDrivers}
        dispatches={dispatches}
        arrivalConfirmations={arrivalConfirmations}
        driverLocations={driverLocations}
        locationError={locationError}
      />
    );
  }


  return (
    <AppLayout>
      {message && (
        <div className="success-message dashboard-alert">
          {message}
        </div>
      )}

      {error && (
        <div className="error-message dashboard-alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="dashboard-loading">
          <div className="loading-spinner" />

          <p>
            Loading TaxiLink dashboard...
          </p>
        </div>
      ) : (
        dashboard
      )}
    </AppLayout>
  );
}