
import { useCallback, useEffect, useState } from "react";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";

import "./DispatchPage.css";



const MAX_TAXI_CAPACITY = 15;
const GPS_UPDATE_INTERVAL_MS = 5000;
const DASHBOARD_REFRESH_INTERVAL_MS = 10000;

const GPS_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0,
};

const TRACKED_STATUSES = ["ACCEPTED", "EN_ROUTE", "ARRIVED"];

const initialForm = {
  driver: "",
  waiting_spot: "",
  passenger_count: 1,
  notes: "",
};

// ============================================================
// HELPERS
// ============================================================

function toList(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.results) ? data.results : [];
}

function extractError(error, fallback) {
  const data = error?.response?.data;

  if (!data) return error?.message || fallback;
  if (typeof data === "string") return data;
  if (data.detail) return String(data.detail);

  const first = Object.values(data).flat()[0];

  if (first && typeof first === "object") {
    return String(Object.values(first).flat()[0] || fallback);
  }

  return String(first || fallback);
}

function taxiServiceIsOpen() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(
    parts.find((part) => part.type === "hour")?.value
  );

  const minute = Number(
    parts.find((part) => part.type === "minute")?.value
  );

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false;
  }

  const now = hour * 60 + minute;

  return now >= 4 * 60 && now < 17 * 60;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error("Your browser does not support GPS location.")
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      GPS_OPTIONS
    );
  });
}

function getLocationError(error) {
  if (error?.code === 1) {
    return (
      "Location permission was denied. " +
      "Enable location access and retry."
    );
  }

  if (error?.code === 2) {
    return (
      "Your device could not determine its location. " +
      "Check your GPS."
    );
  }

  if (error?.code === 3) {
    return (
      "GPS location timed out. " +
      "Move to an open area and try again."
    );
  }

  return error?.message || "GPS location is unavailable.";
}

function groupTotal(groups, selectedStatus) {
  return groups
    .filter(
      (group) =>
        !selectedStatus || group.status === selectedStatus
    )
    .reduce(
      (total, group) =>
        total + Number(group.party_size || 0),
      0
    );
}

// ============================================================
// PASSENGER GROUP SUMMARY
// ============================================================

function GroupSummary({
  groups,
  showPassengerNames = false,
}) {
  if (!groups.length) {
    return (
      <p className="empty-note">
        No linked passenger groups are available for this
        dispatch.
      </p>
    );
  }

  return (
    <div className="dispatch-group-summary">
      <h5>Passenger Groups</h5>

      <p>
        {groups.length} group(s) · {groupTotal(groups)}{" "}
        passenger(s) ·{" "}
        {groupTotal(groups, "BOARDED")} boarded
      </p>

      <ul className="dispatch-group-list">
        {groups.map((group) => (
          <li key={group.id}>
            <span>
              <strong>
                {group.party_size} passenger(s)
              </strong>

              {showPassengerNames &&
              group.passenger_username
                ? " · " + group.passenger_username
                : ""}

              {group.waiting_spot_name
                ? " · " + group.waiting_spot_name
                : ""}
            </span>

            <span
              className={
                "status-badge " +
                (group.status === "BOARDED"
                  ? "active"
                  : "inactive")
              }
            >
              {group.status === "RESERVED"
                ? "Awaiting boarding"
                : group.status === "BOARDED"
                  ? "Boarded"
                  : group.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================
// MAIN DISPATCH PAGE
// ============================================================

export default function DispatchPage() {
  const { user } = useAuth();

  const isDriver = user?.role === "DRIVER";
  const isDispatcher = user?.role === "DISPATCHER";

  const [assignments, setAssignments] = useState([]);
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [waitingSpots, setWaitingSpots] = useState([]);

  const [availability, setAvailability] = useState(null);

  const [serviceOpen, setServiceOpen] = useState(
    taxiServiceIsOpen()
  );

  const [form, setForm] = useState(initialForm);

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [busyAssignmentId, setBusyAssignmentId] =
    useState(null);

  const [boardingCodes, setBoardingCodes] = useState({});

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [gpsStatus, setGpsStatus] = useState("inactive");
  const [gpsError, setGpsError] = useState("");
  const [lastGpsUpdate, setLastGpsUpdate] = useState(null);
  const [gpsRetryKey, setGpsRetryKey] = useState(0);

  // ==========================================================
  // ACTIVE DRIVER ASSIGNMENT
  // ==========================================================

  const activeAssignment = isDriver
    ? assignments.find((item) =>
        TRACKED_STATUSES.includes(item.status)
      )
    : null;

  const activeAssignmentId = activeAssignment?.id ?? null;

  const selectedSpot = waitingSpots.find(
    (spot) =>
      String(spot.id) === String(form.waiting_spot)
  );

  const selectedSpotDemand = Number(
    selectedSpot?.active_waiting_count || 0
  );

  const maxAssignable = selectedSpot
    ? Math.min(MAX_TAXI_CAPACITY, selectedSpotDemand)
    : MAX_TAXI_CAPACITY;

  // ==========================================================
  // LOAD DISPATCH INFORMATION
  // ==========================================================

  const loadData = useCallback(
    async (silent = false) => {
      setServiceOpen(taxiServiceIsOpen());

      if (!silent) {
        setLoading(true);
      }

      try {
        const assignmentsResponse = await api.get(
          "/transport/dispatches/"
        );

        setAssignments(
          toList(assignmentsResponse.data)
        );

        if (isDriver) {
          const response = await api.get(
            "/transport/drivers/availability/"
          );

          setAvailability(response.data);
        }

        if (isDispatcher) {
          const [
            driversResponse,
            spotsResponse,
          ] = await Promise.all([
            api.get("/transport/drivers/available/"),
            api.get("/transport/waiting-spots/"),
          ]);

          setAvailableDrivers(
            toList(driversResponse.data)
          );

          setWaitingSpots(
            toList(spotsResponse.data).filter(
              (spot) =>
                spot.is_active &&
                spot.service_is_open &&
                Number(spot.active_waiting_count) > 0
            )
          );
        }
      } catch (requestError) {
        if (!silent) {
          setError(
            extractError(
              requestError,
              "Dispatch information could not be loaded."
            )
          );
        }
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

    const id = window.setInterval(
      () => loadData(true),
      DASHBOARD_REFRESH_INTERVAL_MS
    );

    return () => window.clearInterval(id);
  }, [loadData]);

  // ==========================================================
  // DRIVER GPS SHARING EVERY 5 SECONDS
  // ==========================================================

  useEffect(() => {
    if (!isDriver || activeAssignmentId == null) {
      setGpsStatus("inactive");
      setGpsError("");
      setLastGpsUpdate(null);

      return undefined;
    }

    if (!navigator.geolocation) {
      setGpsStatus("error");
      setGpsError(
        "GPS is not supported by this browser."
      );

      return undefined;
    }

    let stopped = false;
    let sending = false;
    let intervalId = null;

    setGpsStatus("starting");
    setGpsError("");

    const sendLocation = () => {
      if (stopped || sending) {
        return;
      }

      sending = true;

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          if (stopped) {
            sending = false;
            return;
          }

          const {
            latitude,
            longitude,
            accuracy,
          } = position.coords;

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            sending = false;

            setGpsStatus("error");

            setGpsError(
              "Invalid GPS coordinates received."
            );

            return;
          }

          try {
            const response = await api.post(
              "/transport/dispatches/" +
                activeAssignmentId +
                "/location/",
              {
                latitude: latitude.toFixed(6),
                longitude: longitude.toFixed(6),

                accuracy_meters:
                  Number.isFinite(accuracy)
                    ? accuracy
                    : null,
              }
            );

            if (!stopped) {
              setGpsStatus("sharing");
              setGpsError("");

              setLastGpsUpdate(
                response.data?.recorded_at ||
                  new Date().toISOString()
              );
            }
          } catch (requestError) {
            if (!stopped) {
              setGpsStatus("error");

              setGpsError(
                extractError(
                  requestError,
                  "The GPS update could not be sent."
                )
              );
            }
          } finally {
            sending = false;
          }
        },

        (locationError) => {
          sending = false;

          if (stopped) {
            return;
          }

          setGpsStatus("error");

          setGpsError(
            getLocationError(locationError)
          );

          if (
            locationError.code === 1 &&
            intervalId != null
          ) {
            window.clearInterval(intervalId);
          }
        },

        GPS_OPTIONS
      );
    };

    intervalId = window.setInterval(
      sendLocation,
      GPS_UPDATE_INTERVAL_MS
    );

    sendLocation();

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [
    isDriver,
    activeAssignmentId,
    gpsRetryKey,
  ]);

  // ==========================================================
  // DISPATCHER FORM
  // ==========================================================

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const createDispatch = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!taxiServiceIsOpen()) {
      setError(
        "New dispatches are unavailable " +
          "between 17:00 and 04:00."
      );

      return;
    }

    const passengerCount = Number(
      form.passenger_count
    );

    if (
      !form.driver ||
      !selectedSpot ||
      !Number.isInteger(passengerCount) ||
      passengerCount < 1 ||
      passengerCount > MAX_TAXI_CAPACITY ||
      passengerCount > selectedSpotDemand
    ) {
      setError(
        "Select an available driver, waiting spot, " +
          "and valid seat total (1–15)."
      );

      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post(
        "/transport/dispatches/",
        {
          driver: Number(form.driver),

          waiting_spot: Number(
            form.waiting_spot
          ),

          passenger_count: passengerCount,

          notes: form.notes,
        }
      );

      const groups = Array.isArray(
        response.data?.groups
      )
        ? response.data.groups
        : [];

      setMessage(
        "Dispatch created for " +
          passengerCount +
          " passengers in " +
          groups.length +
          " complete group(s)."
      );

      setForm(initialForm);

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "The dispatch could not be created."
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================================
  // DRIVER AVAILABILITY
  // ==========================================================

  const toggleAvailability = async () => {
    setError("");
    setMessage("");

    if (!taxiServiceIsOpen()) {
      setError(
        "Driver availability is closed " +
          "between 17:00 and 04:00."
      );

      return;
    }

    if (!availability || updating) {
      return;
    }

    setUpdating(true);

    try {
      const response = await api.patch(
        "/transport/drivers/availability/",
        {
          is_available:
            !availability.is_available,
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

  // ==========================================================
  // DRIVER DISPATCH ACTIONS
  // ==========================================================

  const respondToDispatch = async (
    assignment,
    actionName
  ) => {
    if (busyAssignmentId != null) {
      return;
    }

    setError("");
    setMessage("");
    setBusyAssignmentId(assignment.id);

    try {
      let payload = {};

      if (actionName === "arrived") {
        const position =
          await getCurrentPosition();

        const {
          latitude,
          longitude,
          accuracy,
        } = position.coords;

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          throw new Error(
            "Your device returned invalid GPS coordinates."
          );
        }

        const radius = Number(
          assignment.pickup_geofence_radius_meters
        );

        if (
          Number.isFinite(accuracy) &&
          Number.isFinite(radius) &&
          accuracy > Math.max(radius, 50)
        ) {
          throw new Error(
            "GPS accuracy is approximately " +
              Math.round(accuracy) +
              " metres. Move to an open area and retry."
          );
        }

        payload = {
          latitude: latitude.toFixed(6),
          longitude: longitude.toFixed(6),

          accuracy_meters:
            Number.isFinite(accuracy)
              ? accuracy
              : null,
        };
      }

      await api.post(
        "/transport/dispatches/" +
          assignment.id +
          "/" +
          actionName +
          "/",
        payload
      );

      const responseMessages = {
        accept:
          "Dispatch accepted. GPS sharing is starting.",

        reject:
          "Dispatch rejected. Reserved groups have been released.",

        "en-route":
          "You are now en route.",

        arrived:
          "Arrival verified at the pickup geofence. " +
          "Check boarding codes.",

        completed:
          "Trip completed. Passengers can confirm safe arrival.",
      };

      setMessage(
        responseMessages[actionName] ||
          "Dispatch updated successfully."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        requestError.response
          ? extractError(
              requestError,
              "The dispatch action failed."
            )
          : getLocationError(requestError)
      );
    } finally {
      setBusyAssignmentId(null);
    }
  };

  // ==========================================================
  // VERIFY PASSENGER BOARDING CODE
  // ==========================================================

  const verifyBoarding = async (
    event,
    assignment
  ) => {
    event.preventDefault();

    if (busyAssignmentId != null) {
      return;
    }

    const code =
      boardingCodes[assignment.id] || "";

    if (!/^[0-9]{8}$/.test(code)) {
      setError(
        "Enter the passenger group's full " +
          "8-digit boarding code."
      );

      return;
    }

    setError("");
    setMessage("");

    setBusyAssignmentId(assignment.id);

    try {
      const response = await api.post(
        "/transport/dispatches/" +
          assignment.id +
          "/verify-boarding/",
        {
          code,
        }
      );

      setBoardingCodes((current) => ({
        ...current,
        [assignment.id]: "",
      }));

      setMessage(
        "Boarding confirmed for " +
          response.data.party_size +
          " passenger(s). " +
          response.data.remaining_groups +
          " group(s) remain."
      );

      await loadData(true);
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Boarding verification failed. Check the code."
        )
      );
    } finally {
      setBusyAssignmentId(null);
    }
  };

  // ==========================================================
  // NAVIGATE TO WAITING SPOT
  // ==========================================================

  const navigateToWaitingSpot = (
    assignment
  ) => {
    setError("");

    if (
      assignment.pickup_source !==
      "waiting_spot_coordinates"
    ) {
      setError(
        "The backend has not provided " +
          "a verified waiting-spot destination."
      );

      return;
    }

    const latitude = Number(
      assignment.pickup_latitude
    );

    const longitude = Number(
      assignment.pickup_longitude
    );

    if (
      assignment.pickup_latitude == null ||
      assignment.pickup_longitude == null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setError(
        "Waiting-spot GPS coordinates are " +
          "unavailable or invalid."
      );

      return;
    }

    const destination =
      latitude + "," + longitude;

    const mapsUrl =
      "https://www.google.com/maps/dir/?api=1&destination=" +
      encodeURIComponent(destination) +
      "&travelmode=driving&dir_action=navigate";

    window.open(
      mapsUrl,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // ==========================================================
  // PAGE INTERFACE
  // ==========================================================

  return (
    <AppLayout>
      <section className="page-heading">
        <h2>Taxi Dispatch</h2>

        <p>
          Service hours:{" "}
          <strong>04:00–17:00</strong>
        </p>
      </section>

      {!serviceOpen && (
        <div className="error-message">
          TaxiLink is closed for new dispatches
          and driver availability.
        </div>
      )}

      {message && (
        <div
          className="success-message"
          role="status"
        >
          {message}
        </div>
      )}

      {error && (
        <div
          className="error-message"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* ====================================================
          DRIVER AVAILABILITY
      ==================================================== */}

      {isDriver && availability && (
        <section className="availability-card">
          <div>
            <h3>Driver Availability</h3>

            <span
              className={
                "status-badge " +
                (serviceOpen &&
                availability.is_available
                  ? "active"
                  : "inactive")
              }
            >
              {!serviceOpen
                ? "Service unavailable"
                : availability.is_available
                  ? "Available"
                  : "Unavailable"}
            </span>

            {!serviceOpen && (
              <p>
                Driver availability resumes at
                04:00.
              </p>
            )}
          </div>

          <button
            className={
              availability.is_available
                ? "danger-button"
                : "action-button"
            }
            type="button"
            disabled={
              updating || !serviceOpen
            }
            onClick={toggleAvailability}
          >
            {!serviceOpen
              ? "Available from 04:00"
              : updating
                ? "Updating..."
                : availability.is_available
                  ? "Go unavailable"
                  : "Go available"}
          </button>
        </section>
      )}

      {/* ====================================================
          DRIVER GPS SHARING
      ==================================================== */}

      {isDriver && activeAssignment && (
        <section className="availability-card">
          <div>
            <h3>Driver GPS Sharing</h3>

            <span
              className={
                "status-badge " +
                (gpsStatus === "sharing"
                  ? "active"
                  : "inactive")
              }
            >
              {gpsStatus === "sharing"
                ? "Sharing location"
                : gpsStatus === "starting"
                  ? "Starting GPS..."
                  : "GPS not sharing"}
            </span>

            <p>
              Your GPS position is sent to your
              dispatcher about every 5 seconds
              while this page remains open.
            </p>

            {lastGpsUpdate && (
              <p>
                Last update:{" "}
                {new Date(
                  lastGpsUpdate
                ).toLocaleTimeString()}
              </p>
            )}

            {gpsError && (
              <p className="empty-note">
                {gpsError}
              </p>
            )}
          </div>

          {gpsStatus === "error" && (
            <button
              type="button"
              className="action-button"
              onClick={() =>
                setGpsRetryKey(
                  (current) => current + 1
                )
              }
            >
              Retry GPS Sharing
            </button>
          )}
        </section>
      )}

      {/* ====================================================
          DISPATCHER ASSIGNMENT FORM
      ==================================================== */}

      {isDispatcher && (
        <section className="form-card dispatch-form">
          <h3>
            Create Dispatch Assignment
          </h3>

          

          {!serviceOpen && (
            <p className="empty-note">
              New assignments are available
              from 04:00 to 17:00.
            </p>
          )}

          <form onSubmit={createDispatch}>
            <label>
              Available driver

              <select
                name="driver"
                value={form.driver}
                onChange={handleChange}
                disabled={
                  !serviceOpen || submitting
                }
                required
              >
                <option value="">
                  Select driver
                </option>

                {availableDrivers.map(
                  (driver) => (
                    <option
                      key={driver.id}
                      value={driver.id}
                    >
                      {driver.full_name ||
                        driver.username}{" "}
                      — {driver.username}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              Waiting spot

              <select
                name="waiting_spot"
                value={form.waiting_spot}
                onChange={handleChange}
                disabled={
                  !serviceOpen || submitting
                }
                required
              >
                <option value="">
                  Select waiting spot
                </option>

                {waitingSpots.map(
                  (spot) => (
                    <option
                      key={spot.id}
                      value={spot.id}
                    >
                      {spot.name} —{" "}
                      {spot.active_waiting_count}{" "}
                      passenger(s) /{" "}
                      {spot.waiting_group_count}{" "}
                      group(s)
                    </option>
                  )
                )}
              </select>
            </label>

            {selectedSpot && (
              <p className="empty-note">
                Unassigned demand:{" "}
                <strong>
                  {selectedSpotDemand}
                </strong>{" "}
                passenger(s) in{" "}
                <strong>
                  {
                    selectedSpot.waiting_group_count
                  }
                </strong>{" "}
                group(s).
              </p>
            )}

            <label>
              Number of seats to allocate

              <input
                name="passenger_count"
                type="number"
                min="1"
                max={maxAssignable}
                step="1"
                value={
                  form.passenger_count
                }
                onChange={handleChange}
                disabled={
                  !serviceOpen || submitting
                }
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
                disabled={
                  !serviceOpen || submitting
                }
                placeholder="Optional instructions for the driver"
              />
            </label>

            <button
              type="submit"
              disabled={
                !serviceOpen ||
                submitting ||
                availableDrivers.length === 0 ||
                waitingSpots.length === 0
              }
            >
              {submitting
                ? "Creating dispatch..."
                : serviceOpen
                  ? "Dispatch driver"
                  : "Dispatch unavailable"}
            </button>
          </form>

          {serviceOpen &&
            availableDrivers.length === 0 && (
              <p className="empty-note">
                No drivers are currently available.
              </p>
            )}

          {serviceOpen &&
            waitingSpots.length === 0 && (
              <p className="empty-note">
                No waiting spots currently have
                unassigned passenger demand.
              </p>
            )}
        </section>
      )}

      {/* ====================================================
          DISPATCH ASSIGNMENTS
      ==================================================== */}

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

        {!loading &&
          assignments.length === 0 && (
            <div className="route-card">
              No dispatch assignments yet.
            </div>
          )}

        {!loading &&
          assignments.map((assignment) => {
            const active =
              TRACKED_STATUSES.includes(
                assignment.status
              );

            const busy =
              busyAssignmentId ===
              assignment.id;

            const groups = Array.isArray(
              assignment.groups
            )
              ? assignment.groups
              : [];

            const waitingGroups =
              groups.filter(
                (group) =>
                  group.status === "RESERVED"
              );

            const allBoarded =
              groups.length > 0 &&
              groups.every(
                (group) =>
                  group.status === "BOARDED"
              );

            const inputCode =
              boardingCodes[assignment.id] ||
              "";

            return (
              <article
                className="dispatch-card"
                key={assignment.id}
              >
                <div>
                  <div className="dispatch-title-row">
                    <h4>
                      {
                        assignment.waiting_spot_name
                      }
                    </h4>

                    <span
                      className={
                        "dispatch-status " +
                        String(
                          assignment.status
                        ).toLowerCase()
                      }
                    >
                      {assignment.status_display ||
                        assignment.status}
                    </span>
                  </div>

                  <p>
                    Route:{" "}
                    {assignment.route_name}
                  </p>

                  <p>
                    Driver:{" "}
                    {assignment.driver_name}
                  </p>

                  <p>
                    Passengers assigned:{" "}
                    <strong>
                      {
                        assignment.passenger_count
                      }
                    </strong>{" "}
                    / {MAX_TAXI_CAPACITY} seats
                  </p>

                  {isDriver && active && (
                    <>
                      <p>
                        Pickup location:{" "}
                        <strong>
                          {
                            assignment.pickup_location_label
                          }
                        </strong>
                      </p>

                      <p>
                        Pickup geofence:{" "}
                        {
                          assignment.pickup_geofence_radius_meters
                        }{" "}
                        metres
                      </p>
                    </>
                  )}

                  {assignment.notes && (
                    <p>
                      Notes:{" "}
                      {assignment.notes}
                    </p>
                  )}

                  <small>
                    Created:{" "}
                    {new Date(
                      assignment.created_at
                    ).toLocaleString()}
                  </small>
                </div>

                {/* PASSENGER GROUPS */}

                <GroupSummary
                  groups={groups}
                  showPassengerNames={
                    isDriver ||
                    isDispatcher
                  }
                />

                {/* NAVIGATION */}

                {isDriver && active && (
                  <div className="dispatch-actions">
                    <button
                      className="action-button"
                      type="button"
                      onClick={() =>
                        navigateToWaitingSpot(
                          assignment
                        )
                      }
                    >
                      Navigate to Waiting Spot
                    </button>
                  </div>
                )}

                {/* PENDING */}

                {isDriver &&
                  assignment.status ===
                    "PENDING" && (
                    <div className="dispatch-actions">
                      <button
                        className="action-button"
                        type="button"
                        disabled={
                          busyAssignmentId != null
                        }
                        onClick={() =>
                          respondToDispatch(
                            assignment,
                            "accept"
                          )
                        }
                      >
                        {busy
                          ? "Processing..."
                          : "Accept"}
                      </button>

                      <button
                        className="danger-button"
                        type="button"
                        disabled={
                          busyAssignmentId != null
                        }
                        onClick={() =>
                          respondToDispatch(
                            assignment,
                            "reject"
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}

                {/* ACCEPTED */}

                {isDriver &&
                  assignment.status ===
                    "ACCEPTED" && (
                    <div className="dispatch-actions">
                      <button
                        className="action-button"
                        type="button"
                        disabled={
                          busyAssignmentId != null
                        }
                        onClick={() =>
                          respondToDispatch(
                            assignment,
                            "en-route"
                          )
                        }
                      >
                        {busy
                          ? "Updating..."
                          : "Mark En Route"}
                      </button>
                    </div>
                  )}

                {/* EN ROUTE */}

                {isDriver &&
                  assignment.status ===
                    "EN_ROUTE" && (
                    <div className="dispatch-actions">
                      <button
                        className="action-button"
                        type="button"
                        disabled={
                          busyAssignmentId != null
                        }
                        onClick={() =>
                          respondToDispatch(
                            assignment,
                            "arrived"
                          )
                        }
                      >
                        {busy
                          ? "Verifying GPS..."
                          : "Arrived at Pickup"}
                      </button>
                    </div>
                  )}

                {/* ====================================================
                    ARRIVED — BOARD PASSENGER GROUPS
                ==================================================== */}

                {isDriver &&
                  assignment.status ===
                    "ARRIVED" && (
                    <div className="dispatch-boarding-panel">
                      <h5>
                        Board Passenger Groups
                      </h5>

                      {waitingGroups.length > 0 ? (
                        <>
                          <p>
                            Ask each group leader
                            for their 8-digit
                            boarding code. Enter
                            the code below to board
                            the entire group.
                          </p>

                          <form
                            onSubmit={(event) =>
                              verifyBoarding(
                                event,
                                assignment
                              )
                            }
                          >
                            <label>
                              Passenger boarding code

                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]{8}"
                                maxLength="8"
                                autoComplete="off"
                                placeholder="8-digit code"
                                value={inputCode}
                                onChange={(
                                  event
                                ) => {
                                  const code =
                                    event.target.value
                                      .replace(
                                        /\D/g,
                                        ""
                                      )
                                      .slice(
                                        0,
                                        8
                                      );

                                  setBoardingCodes(
                                    (
                                      current
                                    ) => ({
                                      ...current,

                                      [assignment.id]:
                                        code,
                                    })
                                  );
                                }}
                                disabled={
                                  busyAssignmentId !=
                                  null
                                }
                                required
                              />
                            </label>

                            <button
                              className="action-button"
                              type="submit"
                              disabled={
                                busyAssignmentId !=
                                  null ||
                                inputCode.length !==
                                  8
                              }
                            >
                              {busy
                                ? "Verifying..."
                                : "Verify and Board Group"}
                            </button>
                          </form>

                          <p className="empty-note">
                            {
                              waitingGroups.length
                            }{" "}
                            group(s) still need
                            boarding verification.
                          </p>
                        </>
                      ) : (
                        <p className="success-message">
                          All assigned passenger
                          groups are boarded.
                        </p>
                      )}

                      {/* COMPLETE TRIP */}

                      <div className="dispatch-actions">
                        <button
                          className="action-button"
                          type="button"
                          disabled={
                            busyAssignmentId !=
                              null ||
                            !allBoarded
                          }
                          onClick={() =>
                            respondToDispatch(
                              assignment,
                              "completed"
                            )
                          }
                        >
                          {busy
                            ? "Completing..."
                            : "Complete Trip"}
                        </button>
                      </div>

                      {!allBoarded && (
                        <p className="empty-note">
                          Trip completion is locked
                          until every assigned group
                          successfully verifies
                          boarding.
                        </p>
                      )}
                    </div>
                  )}
              </article>
            );
          })}
      </section>
    </AppLayout>
  );
}