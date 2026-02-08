"use client";
import { useCustomerStore } from "@/stores/customer-store";
import { Store, User } from "lucide-react";
import Link from "next/link";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branchName = useCustomerStore((s) => s.branchName);
  const branchSlug = useCustomerStore((s) => s.branchSlug);
  const tableCode = useCustomerStore((s) => s.tableCode);
  const token = useCustomerStore((s) => s.token);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="w-8" />
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold truncate">
              {branchName || "RestAI"}
            </h1>
          </div>
          {token && branchSlug && tableCode ? (
            <Link
              href={`/${branchSlug}/${tableCode}/profile`}
              className="flex items-center justify-center h-8 w-8 rounded-full bg-muted hover:bg-muted/80 transition-colors"
            >
              <User className="h-4 w-4 text-foreground" />
            </Link>
          ) : (
            <div className="w-8" />
          )}
        </div>
      </header>
      <main className="max-w-lg mx-auto">{children}</main>
    </div>
  );
}
