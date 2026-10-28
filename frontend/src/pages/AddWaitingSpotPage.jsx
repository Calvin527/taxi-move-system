
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

import api from "../api/client";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/AuthContext";

import "./AddWaitingSpotPage.css";

const initialForm = {
  name: "",
  latitude: "",
  longitude: "",
  geofence_radius_meters: 100,
};

// ============================================================
// HELPERS
// ============================================================

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

function validCoordinates(latitude, longitude) {
  if (
    latitude === "" ||
    longitude === "" ||
    latitude == null ||
    longitude == null
  ) {
    return null;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return [lat, lng];
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

// ============================================================
// INTERACTIVE MAP
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

  // CREATE MAP

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
          '&copy; <a href="https://www.openstreetmap.org/copyright">' +
          "OpenStreetMap</a> contributors",
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
        ? new ResizeObserver(() =>
            map.invalidateSize()
          )
        : null;

    resizeObserver?.observe(containerRef.current);

    const timer = window.setTimeout(
      () => map.invalidateSize(),
      100
    );

    return () => {
      window.clearTimeout(timer);
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

  // DISPLAY OTHER WAITING SPOTS

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
      popup.textContent = spot.name;

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

  // DISPLAY SELECTED LOCATION AND GEOFENCE

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
        const position =
          markerRef.current.getLatLng();

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
        className="waiting-spot-map"
        role="region"
        aria-label="Select taxi waiting spot location"
      />

      <p className="empty-note">
        Click the map to select a collection point.
        You can drag the marker to adjust its location.
        The blue circle represents the geofence.
      </p>
    </div>
  );
}

// ============================================================
// ADD / EDIT WAITING SPOT PAGE
// ============================================================

export default function AddWaitingSpotPage() {
  const { user } = useAuth();

  const navigate = useNavigate();
  const { routeId, spotId } = useParams();

  const isDispatcher = user?.role === "DISPATCHER";
  const isEditing = Boolean(spotId);

  const [route, setRoute] = useState(null);
  const [existingSpots, setExistingSpots] = useState([]);

  const [form, setForm] = useState(initialForm);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // ==========================================================
  // LOAD SELECTED ROUTE
  // ==========================================================

  useEffect(() => {
    if (!isDispatcher) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function loadPage() {
      setLoading(true);
      setError("");

      try {
        const requests = [
          api.get(
            "/transport/routes/" + routeId + "/"
          ),

          api.get(
            "/transport/waiting-spots/"
          ),
        ];

        if (isEditing) {
          requests.push(
            api.get(
              "/transport/waiting-spots/" +
                spotId +
                "/"
            )
          );
        }

        const responses = await Promise.all(requests);

        if (cancelled) {
          return;
        }

        const selectedRoute = responses[0].data;

        const spots = toList(responses[1].data);

        setRoute(selectedRoute);

        setExistingSpots(
          spots.filter(
            (spot) =>
              Number(spot.route) === Number(routeId) &&
              Number(spot.id) !== Number(spotId)
          )
        );

        if (isEditing) {
          const spot = responses[2].data;

          if (
            Number(spot.route) !== Number(routeId)
          ) {
            setError(
              "This waiting spot does not belong to the selected route."
            );
            return;
          }

          setForm({
            name: spot.name,
            latitude: String(spot.latitude),
            longitude: String(spot.longitude),

            geofence_radius_meters:
              spot.geofence_radius_meters,
          });
        } else {
          setForm(initialForm);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(
            extractError(
              requestError,
              "The waiting spot page could not be loaded."
            )
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [
    routeId,
    spotId,
    isEditing,
    isDispatcher,
  ]);

  // ==========================================================
  // FORM ACTIONS
  // ==========================================================

  const handleChange = (event) => {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const selectMapLocation = useCallback(
    (latitude, longitude) => {
      setForm((current) => ({
        ...current,
        latitude,
        longitude,
      }));
    },
    []
  );

  const useCurrentLocation = async () => {
    setError("");
    setMessage("");
    setLocating(true);

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
        locationError.message ||
          "Your location could not be obtained."
      );
    } finally {
      setLocating(false);
    }
  };

  // ==========================================================
  // SAVE WAITING SPOT
  // ==========================================================

  const saveWaitingSpot = async (event) => {
    event.preventDefault();

    setError("");
    setMessage("");

    const coordinates = validCoordinates(
      form.latitude,
      form.longitude
    );

    if (!coordinates) {
      setError(
        "Please select a valid waiting spot location on the map."
      );
      return;
    }

    const name = form.name.trim();

    if (!name) {
      setError("Enter a waiting spot name.");
      return;
    }

    const radius = Number(
      form.geofence_radius_meters
    );

    if (
      !Number.isInteger(radius) ||
      radius < 20 ||
      radius > 1000
    ) {
      setError(
        "Geofence radius must be between 20 and 1000 metres."
      );
      return;
    }

    if (!route || (isEditing && !spotId)) {
      setError("The selected route is unavailable.");
      return;
    }

    const payload = {
      route: Number(routeId),
      name,
      latitude: form.latitude,
      longitude: form.longitude,
      geofence_radius_meters: radius,
    };

    setSaving(true);

    try {
      if (isEditing) {
        await api.patch(
          "/transport/waiting-spots/" +
            spotId +
            "/",
          payload
        );
      } else {
        await api.post(
          "/transport/waiting-spots/",
          payload
        );
      }

      navigate("/routes", {
        replace: true,
        state: {
          notice: isEditing
            ? "Waiting spot updated successfully."
            : "Waiting spot created successfully.",
        },
      });
    } catch (requestError) {
      setError(
        extractError(
          requestError,
          "Waiting spot could not be saved."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <AppLayout>
      <div className="spot-editor-shell">
        <section className="page-heading">
          <h2>
            {isEditing
              ? "Edit Waiting Spot"
              : "Add Waiting Spot"}
          </h2>

          <p>
            Select the passenger collection point
            directly on the map.
          </p>
        </section>

        <Link
          to="/routes"
          className="secondary-button spot-back-link"
        >
          ← Back to Routes
        </Link>

        {!isDispatcher && (
          <div className="error-message">
            Only dispatchers can manage waiting spots.
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

        {message && (
          <div className="success-message">
            {message}
          </div>
        )}

        {loading && (
          <div className="page-message">
            Loading waiting spot...
          </div>
        )}

        {!loading &&
          isDispatcher &&
          route &&
          !(
            isEditing &&
            error.includes("does not belong")
          ) && (
            <section className="form-card spot-editor-card">
              <div className="selected-route-info">
                <span>SELECTED ROUTE</span>

                <h3>{route.name}</h3>

                <p>
                  {route.origin} → {route.destination}
                </p>
              </div>

              <form onSubmit={saveWaitingSpot}>
                <label>
                  Waiting Spot Name

                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="e.g. University Main Gate"
                    maxLength={100}
                    required
                  />
                </label>

                <h4>Select Pickup Location</h4>

                <WaitingSpotMapPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  radius={form.geofence_radius_meters}
                  existingSpots={existingSpots}
                  onSelect={selectMapLocation}
                />

                <button
                  type="button"
                  className="secondary-button"
                  disabled={locating || saving}
                  onClick={useCurrentLocation}
                >
                  {locating
                    ? "Getting location..."
                    : "Use My Current Location"}
                </button>

                <div className="spot-coordinate-grid">
                  <label>
                    Latitude

                    <input
                      value={form.latitude}
                      placeholder="Select on map"
                      readOnly
                      required
                    />
                  </label>

                  <label>
                    Longitude

                    <input
                      value={form.longitude}
                      placeholder="Select on map"
                      readOnly
                      required
                    />
                  </label>
                </div>

                <label>
                  Geofence radius:{" "}
                  <strong>
                    {form.geofence_radius_meters} metres
                  </strong>

                  <input
                    name="geofence_radius_meters"
                    type="range"
                    min="20"
                    max="1000"
                    step="10"
                    value={
                      form.geofence_radius_meters
                    }
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Radius in metres

                  <input
                    name="geofence_radius_meters"
                    type="number"
                    min="20"
                    max="1000"
                    value={
                      form.geofence_radius_meters
                    }
                    onChange={handleChange}
                    required
                  />
                </label>

                <div className="spot-editor-actions">
                  <button
                    type="submit"
                    disabled={
                      saving ||
                      !validCoordinates(
                        form.latitude,
                        form.longitude
                      )
                    }
                  >
                    {saving
                      ? "Saving..."
                      : isEditing
                        ? "Update Waiting Spot"
                        : "Save Waiting Spot"}
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() =>
                      navigate("/routes")
                    }
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
      </div>
    </AppLayout>
  );
}