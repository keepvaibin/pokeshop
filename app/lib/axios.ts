import axios from 'axios';
import { tryRefreshToken } from './auth-refresh';

/**
 * Shared axios instance with automatic 401 → token-refresh → retry.
 *
 * Use this everywhere in the Next.js app instead of the raw `axios` default
 * so that an expired access token is transparently refreshed without the
 * user seeing a spurious error.
 */
const axiosInstance = axios.create();

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    // Extend config with a private retry flag to prevent infinite loops.
    const config = error.config as (typeof error.config) & { _retry?: boolean };

    if (error.response?.status === 401 && config && !config._retry) {
      config._retry = true;
      const newToken = await tryRefreshToken();
      if (newToken) {
        // Patch the Authorization header and replay the original request.
        config.headers = config.headers ?? {};
        config.headers['Authorization'] = `Bearer ${newToken}`;
        return axiosInstance(config);
      }
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;

// Re-export the isAxiosError type-guard so callers don't need to import axios
// directly just for error narrowing.
export const { isAxiosError } = axios;
