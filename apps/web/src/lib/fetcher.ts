import { useAuthStore } from "@/stores/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let refreshPromise: Promise<string | null> | null = null;

type ApiFetchOptions = RequestInit & {
  includeBranchHeader?: boolean;
};

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setAccessToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await res.json();
    if (json.success && json.data.accessToken) {
      // The server now rotates the refresh token: the old one is revoked and a
      // new one is returned. Persist BOTH or the next refresh will fail.
      if (json.data.refreshToken) {
        setTokens(json.data.accessToken, json.data.refreshToken);
      } else {
        setAccessToken(json.data.accessToken);
      }
      return json.data.accessToken;
    }
    logout();
    return null;
  } catch {
    logout();
    return null;
  }
}

export async function apiFetch<T = any>(path: string, options?: ApiFetchOptions): Promise<T> {
  const { accessToken, selectedBranchId } = useAuthStore.getState();
  const {
    includeBranchHeader = true,
    headers: customHeaders,
    ...requestOptions
  } = options ?? {};

  const makeRequest = async (token: string | null) => {
    return fetch(`${API_URL}${path}`, {
      ...requestOptions,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(includeBranchHeader && selectedBranchId
          ? { "x-branch-id": selectedBranchId }
          : {}),
        ...customHeaders,
      },
    });
  };

  let res = await makeRequest(accessToken);

  // If 401, try to refresh the token once
  if (res.status === 401 && accessToken) {
    // Deduplicate concurrent refresh calls
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      res = await makeRequest(newToken);
    }
  }

  const json = await res.json();
  if (!json.success) {
    throw new ApiError(
      json.error?.message || "Error desconocido",
      json.error?.code,
      res.status,
      json.error,
    );
  }
  return json.data as T;
}

/**
 * Error de la API con su código y estado HTTP.
 *
 * Antes se lanzaba un `Error` pelado con solo el mensaje, así que la interfaz no
 * podía distinguir un 409 de concurrencia ("otra pantalla ya movió esta
 * comanda", que se resuelve refrescando) de un 400 de validación, y todos los
 * fallos acababan en el mismo aviso genérico.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Igual que `apiFetch` pero devuelve la respuesta COMPLETA.
 *
 * `apiFetch` se queda solo con `data` y descarta el resto, lo que deja fuera la
 * paginación: las pantallas con listados largos no podían saber cuántas páginas
 * había ni cuántos registros existían en total.
 */
export async function apiFetchWithMeta<T = any>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T> {
  const { accessToken, selectedBranchId } = useAuthStore.getState();
  const {
    includeBranchHeader = true,
    headers: customHeaders,
    ...requestOptions
  } = options ?? {};

  const makeRequest = async (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...requestOptions,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(includeBranchHeader && selectedBranchId
          ? { "x-branch-id": selectedBranchId }
          : {}),
        ...customHeaders,
      },
    });

  let res = await makeRequest(accessToken);

  if (res.status === 401 && accessToken) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      res = await makeRequest(newToken);
    }
  }

  const json = await res.json();
  if (!json.success) {
    throw new ApiError(
      json.error?.message || "Error desconocido",
      json.error?.code,
      res.status,
      json.error,
    );
  }
  return json as T;
}
