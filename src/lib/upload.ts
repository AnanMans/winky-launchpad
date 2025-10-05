import { supabase } from "@/lib/db";

const OK_TYPES = ["image/jpeg","image/png","image/gif","video/mp4"];
const MAX_BYTES = 30 * 1024 * 1024; // 30MB

export async function uploadToMedia(file: File): Promise<string> {
  if (!OK_TYPES.includes(file.type)) throw new Error("Only jpg/png/gif/mp4 allowed.");
  if (file.size > MAX_BYTES) throw new Error("File must be ≤ 30MB.");

  const extFromType = file.type === "video/mp4" ? "mp4"
                    : file.type === "image/jpeg" ? "jpg"
                    : file.type === "image/png" ? "png"
                    : file.type === "image/gif" ? "gif" : "bin";
  const ext = (file.name.split(".").pop()?.toLowerCase() || extFromType);
  const key = `coins/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from("media").upload(key, file, {
    upsert: false,
    cacheControl: "31536000",
    contentType: file.type,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("media").getPublicUrl(key);
  return data.publicUrl;
}

