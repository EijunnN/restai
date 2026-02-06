import { hc } from "hono/client";
// AppType will be imported from the API once the monorepo is fully linked
// For now, use a generic type to avoid build issues
type AppType = any;

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const api = hc<AppType>(apiUrl, {
  headers: () => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    const branchId = localStorage.getItem("selected_branch_id");
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { "x-branch-id": branchId } : {}),
    };
  },
});
