"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Photo, ProjectTask } from "@/lib/types";

export function PhotoSection({
  projectId,
  photos,
  tasks,
  photoUrls,
}: {
  projectId: string;
  photos: Photo[];
  tasks: ProjectTask[];
  photoUrls: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [taskId, setTaskId] = useState("");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("写真を選択してください。");
      return;
    }

    setUploading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("ログインしてください。");
      setUploading(false);
      return;
    }

    const ext = file.name.split(".").pop();
    const path = `${projectId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("project-photos")
      .upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: insertError } = await supabase.from("photos").insert({
      project_id: projectId,
      task_id: taskId || null,
      storage_path: path,
      caption: caption || null,
      uploaded_by: user.id,
    });

    setUploading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setCaption("");
    setTaskId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  }

  const sorted = [...photos].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">現場写真</h2>

      <form
        onSubmit={handleUpload}
        className="mb-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-4"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          required
          className="text-sm sm:col-span-2"
        />
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="">工程に紐付けない</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <input
          placeholder="コメント"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 sm:col-span-4"
        >
          {uploading ? "アップロード中..." : "写真をアップロード"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      </form>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          写真がまだありません。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {sorted.map((photo) => {
            const task = tasks.find((t) => t.id === photo.task_id);
            const url = photoUrls[photo.id];
            return (
              <li key={photo.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={photo.caption ?? ""} className="h-40 w-full object-cover" />
                )}
                <div className="p-2">
                  {task && <p className="text-xs text-zinc-500">{task.title}</p>}
                  {photo.caption && <p className="text-sm text-zinc-800">{photo.caption}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
