"use client";
import { useCustomerStore } from "@/stores/customer-store";
import { Store } from "lucide-react";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branchName = useCustomerStore((s) => s.branchName);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-center gap-2 max-w-lg mx-auto">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold truncate">
            {branchName || "RestAI"}
          </h1>
        </div>
      </header>
      <main className="max-w-lg mx-auto">{children}</main>
    </div>
  );
}
