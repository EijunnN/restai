export const statusConfig: Record<
  string,
  { label: string; color: string; bgColor: string; darkBgColor: string }
> = {
  available: {
    label: "Disponible",
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-50 border-green-200",
    darkBgColor: "dark:bg-green-950/30 dark:border-green-800",
  },
  occupied: {
    label: "Ocupada",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 border-blue-200",
    darkBgColor: "dark:bg-blue-950/30 dark:border-blue-800",
  },
  reserved: {
    label: "Reservada",
    color: "text-orange-700 dark:text-orange-400",
    bgColor: "bg-orange-50 border-orange-200",
    darkBgColor: "dark:bg-orange-950/30 dark:border-orange-800",
  },
  maintenance: {
    label: "Mantenimiento",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 border-red-200",
    darkBgColor: "dark:bg-red-950/30 dark:border-red-800",
  },
};

export const statusOptions = [
  { value: "available", label: "Disponible" },
  { value: "occupied", label: "Ocupada" },
  { value: "reserved", label: "Reservada" },
  { value: "maintenance", label: "Mantenimiento" },
];

export const plannerStatusColors: Record<string, { bg: string; border: string; text: string }> = {
  available: { bg: "bg-green-100 dark:bg-green-900/40", border: "border-green-400 dark:border-green-600", text: "text-green-800 dark:text-green-300" },
  occupied: { bg: "bg-blue-100 dark:bg-blue-900/40", border: "border-blue-400 dark:border-blue-600", text: "text-blue-800 dark:text-blue-300" },
  reserved: { bg: "bg-orange-100 dark:bg-orange-900/40", border: "border-orange-400 dark:border-orange-600", text: "text-orange-800 dark:text-orange-300" },
  maintenance: { bg: "bg-red-100 dark:bg-red-900/40", border: "border-red-400 dark:border-red-600", text: "text-red-800 dark:text-red-300" },
};
