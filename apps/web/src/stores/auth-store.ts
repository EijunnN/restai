import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  branches: string[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  selectedBranchId: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setAccessToken: (token: string) => void;
  setSelectedBranch: (branchId: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      selectedBranchId: null,
      setAuth: (user, accessToken, refreshToken) => {
        const branchId = user.branches?.[0] || null;
        set({ user, accessToken, refreshToken, selectedBranchId: branchId });
        if (typeof window !== "undefined") {
          localStorage.setItem("access_token", accessToken);
          localStorage.setItem("refresh_token", refreshToken);
          if (branchId) localStorage.setItem("selected_branch_id", branchId);
        }
      },
      setAccessToken: (accessToken) => {
        set({ accessToken });
        if (typeof window !== "undefined") {
          localStorage.setItem("access_token", accessToken);
        }
      },
      setSelectedBranch: (branchId) => {
        set({ selectedBranchId: branchId });
        if (typeof window !== "undefined") {
          localStorage.setItem("selected_branch_id", branchId);
        }
      },
      logout: () => {
        set({ user: null, accessToken: null, refreshToken: null, selectedBranchId: null });
        if (typeof window !== "undefined") {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          localStorage.removeItem("selected_branch_id");
        }
      },
      isAuthenticated: () => !!get().accessToken,
    }),
    { name: "restai-auth" }
  )
);
