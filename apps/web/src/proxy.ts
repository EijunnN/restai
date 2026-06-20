import { NextResponse } from "next/server";

// Intentional no-op. Auth is NOT enforced here:
//   - Client-side: the auth store (useAuthStore) gates dashboard routes and
//     redirects unauthenticated users to /login.
//   - API-side: authMiddleware on the Hono API is the real trust boundary —
//     every protected endpoint verifies the JWT and tenant scope server-side.
// The edge proxy cannot read the auth store (tokens live in localStorage,
// not cookies), so any gating done here would be unreliable. Keep this a
// pass-through and let the two layers above do the enforcement.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
