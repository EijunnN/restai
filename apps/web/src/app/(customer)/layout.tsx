"use client";
import { useCustomerStore } from "@/stores/customer-store";
import { User } from "lucide-react";
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
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border shadow-sm pt-4 pb-2 px-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="w-8" />
          <h1 className="text-lg font-semibold tracking-wide text-foreground truncate">
            {branchName || "RestAI"}
          </h1>
          {token && branchSlug && tableCode ? (
            <Link
              href={`/${branchSlug}/${tableCode}/profile`}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-muted-foreground/30 overflow-hidden border border-border transition-colors hover:bg-muted-foreground/40"
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
