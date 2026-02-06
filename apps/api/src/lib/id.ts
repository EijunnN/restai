export function generateOrderNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${date}-${rand}`;
}

export function generateQrCode(branchSlug: string, tableNumber: number): string {
  return `${branchSlug}-T${tableNumber}-${Date.now().toString(36)}`;
}
