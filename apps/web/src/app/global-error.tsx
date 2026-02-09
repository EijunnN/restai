"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "system-ui",
            gap: "1rem",
          }}
        >
          <h2 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            Algo salió mal
          </h2>
          <p style={{ color: "#666" }}>
            {error.message || "Error inesperado"}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              background: "#000",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}
