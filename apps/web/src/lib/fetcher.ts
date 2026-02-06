import { useAuthStore } from "@/stores/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setAccessToken, logout } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const json = await res.json();
    if (json.success && json.data.accessToken) {
      setAccessToken(json.data.accessToken);
      return json.data.accessToken;
    }
    logout();
    return null;
  } catch {
    logout();
    return null;
  }
}

export async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const { accessToken, selectedBranchId } = useAuthStore.getState();

  const makeRequest = async (token: string | null) => {
    return fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(selectedBranchId ? { "x-branch-id": selectedBranchId } : {}),
        ...options?.headers,
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
    throw new Error(json.error?.message || "Error desconocido");
  }
  return json.data as T;
}
