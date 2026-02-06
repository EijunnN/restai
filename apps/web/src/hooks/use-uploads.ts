"use client";
import { useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type UploadType = "menu" | "logo" | "category";

export function useUploadImage() {
  return useMutation({
    mutationFn: async ({
      file,
      type,
    }: {
      file: File;
      type: UploadType;
    }): Promise<{ url: string; key: string }> => {
      const { accessToken, selectedBranchId } = useAuthStore.getState();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);

      const res = await fetch(`${API_URL}/api/uploads`, {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(selectedBranchId ? { "x-branch-id": selectedBranchId } : {}),
        },
        body: formData,
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error?.message || "Error al subir imagen");
      }
      return json.data;
    },
  });
}
