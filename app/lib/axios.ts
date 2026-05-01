import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './api';
import { getFreshAccessToken, tryRefreshToken } from './auth-refresh';

/**
 * Shared axios instance with automatic 401 → token-refresh → retry.
 *
 * Use this everywhere in the Next.js app instead of the raw `axios` default
 * so that an expired access token is transparently refreshed without the
 * user seeing a spurious error.
 */
const axiosInstance = axios.create();

let defaultInterceptorsInstalled = false;

function isApiRequest(url?: string): boolean {
  if (!url) return true;
  if (/^https?:\/\//i.test(url)) return false;
  return url.startsWith(API_BASE_URL) || url.startsWith('/api/') || url.startsWith('api/');
}

async function attachFreshAuthorization(config: InternalAxiosRequestConfig) {
  if (typeof window === 'undefined' || !isApiRequest(config.url)) return config;
  const token = await getFreshAccessToken();
  if (!token) return config;
  config.headers = config.headers ?? {};
  config.headers['Authorization'] = `Bearer ${token}`;
  return config;
}

function buildRefreshRetryInterceptor(instance: AxiosInstance) {
  return async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const config = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && config && !config._retry) {
      config._retry = true;
      const newToken = await tryRefreshToken();
      if (newToken) {
        config.headers = config.headers ?? {};
        config.headers['Authorization'] = `Bearer ${newToken}`;
        return instance(config);
      }
    }

    return Promise.reject(error);
  };
}

axiosInstance.interceptors.request.use(attachFreshAuthorization);

axiosInstance.interceptors.response.use(
  (response) => response,
  buildRefreshRetryInterceptor(axiosInstance)
);

export function installDefaultAxiosAuthInterceptors() {
  if (defaultInterceptorsInstalled) return;
  defaultInterceptorsInstalled = true;
  axios.interceptors.request.use(attachFreshAuthorization);
  axios.interceptors.response.use((response) => response, buildRefreshRetryInterceptor(axios));
}

export default axiosInstance;

// Re-export the isAxiosError type-guard so callers don't need to import axios
// directly just for error narrowing.
export const { isAxiosError } = axios;
