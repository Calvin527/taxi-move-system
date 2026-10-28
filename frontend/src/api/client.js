
import axios from "axios";


// ============================================================
// API BASE URL
// ============================================================

const configuredBaseURL = import.meta.env.VITE_API_BASE_URL;

const baseURL = (
  configuredBaseURL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:8000/api"
    : "")
).replace(/\/+$/, "");

if (!baseURL) {
  throw new Error(
    "VITE_API_BASE_URL must be configured for TAXI MOVE."
  );
}


// ============================================================
// AXIOS INSTANCE
// ============================================================

const api = axios.create({
  baseURL,

  headers: {
    "Content-Type": "application/json",
  },
});


// ============================================================
// REQUEST INTERCEPTOR
// ============================================================

api.interceptors.request.use(
  (config) => {
    const accessToken = localStorage.getItem("access_token");

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
  },

  (error) => Promise.reject(error)
);


// ============================================================
// RESPONSE INTERCEPTOR
// ============================================================

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const originalRequest = error.config;

    if (!originalRequest) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("refresh_token");

    const requestURL = originalRequest.url || "";

    const shouldRefresh =
      error.response?.status === 401 &&
      Boolean(refreshToken) &&
      !originalRequest._retry &&
      !requestURL.includes("accounts/login/") &&
      !requestURL.includes("accounts/token/refresh/");

    if (!shouldRefresh) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const response = await axios.post(
        `${baseURL}/accounts/token/refresh/`,
        {
          refresh: refreshToken,
        }
      );

      const newAccessToken = response.data.access;

      if (!newAccessToken) {
        throw new Error("No access token returned.");
      }

      localStorage.setItem(
        "access_token",
        newAccessToken
      );

      originalRequest.headers =
        originalRequest.headers || {};

      originalRequest.headers.Authorization =
        `Bearer ${newAccessToken}`;

      return api(originalRequest);

    } catch (refreshError) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");

      window.location.href = "/login";

      return Promise.reject(refreshError);
    }
  }
);


export default api;