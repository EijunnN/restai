"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
import { landingRouteForRole } from "@/lib/permissions";

export function useAuth() {
  const {
    user,
    accessToken,
    setAuth,
    logout: clearAuth,
    isAuthenticated,
    selectedBranchId,
    setSelectedBranch,
  } = useAuthStore();
  const router = useRouter();

  const login = async (email: string, password: string) => {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );
    const data = await res.json();
    if (!data.success)
      throw new Error(data.error?.message || "Error al iniciar sesión");
    setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
    if (data.data.user.branches?.length > 0) {
      setSelectedBranch(data.data.user.branches[0]);
    }
    // Cada rol entra donde trabaja, no a una pantalla fija.
    //
    // Iba siempre a /orders: el cocinero empezaba su turno mirando una tabla de
    // pedidos que no puede usar y tenía que buscar su tablero a mano cada vez, y
    // el cajero aterrizaba lejos del POS. `landingRouteForRole` ya resolvía esto
    // para el guard del layout; el login se lo saltaba.
    router.push(landingRouteForRole(data.data.user.role));
  };

  const register = async (input: {
    organizationName: string;
    slug: string;
    email: string;
    password: string;
    name: string;
  }) => {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const data = await res.json();
    if (!data.success)
      throw new Error(data.error?.message || "Error al registrarse");
    setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
    // Quien acaba de registrarse es administrador de su organización: entra al panel.
    router.push(landingRouteForRole(data.data.user.role));
  };

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  return {
    user,
    accessToken,
    selectedBranchId,
    setSelectedBranch,
    login,
    register,
    logout,
    isAuthenticated: isAuthenticated(),
  };
}
