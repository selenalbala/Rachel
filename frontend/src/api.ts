const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/$/, "");

export function getToken(): string | null {
  return localStorage.getItem("rachel_token");
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem("rachel_token", token);
  else localStorage.removeItem("rachel_token");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    setToken(null);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "No se pudo completar la operación.");
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
