"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";
import { useUploadImage } from "@/hooks/use-uploads";
import { toast } from "sonner";

export function ImageUploadButton({
  currentUrl,
  onUploaded,
  uploadType = "menu",
}: {
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  uploadType?: "menu" | "category";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadImage = useUploadImage();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadImage.mutateAsync({ file, type: uploadType });
      onUploaded(result.url);
      toast.success("Imagen subida");
    } catch (err: any) {
      toast.error(err.message || "Error al subir imagen");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      {currentUrl && (
        <img
          src={currentUrl}
          alt=""
          className="h-20 w-20 rounded-lg object-cover"
        />
      )}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        onClick={() => fileRef.current?.click()}
        disabled={uploadImage.isPending}
      >
        <Upload className="h-3 w-3" />
        {uploadImage.isPending
          ? "Subiendo..."
          : currentUrl
            ? "Cambiar"
            : "Imagen"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
