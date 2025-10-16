import axios from "axios";

const fallbackBaseUrl = import.meta.env.PROD
  ? "https://signalsmith-backtester.onrender.com"
  : "http://localhost:8000";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || fallbackBaseUrl,
  timeout: 60000,
});
