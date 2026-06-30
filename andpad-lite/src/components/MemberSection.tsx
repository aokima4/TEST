"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function MemberSection({
  projectId,
  members,
  isOwner,
}: {
  projectId: string;
  members: Profile[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: profile, error: lookupError } = await supabase
      .from("profiles")
      .select("id, role")
      .ilike("display_name", email)
      .maybeSingle();

    if (lookupError || !profile) {
      setError("ユーザーが見つかりませんでした（表示名で検索しています）。");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("project_members").insert({
      project_id: projectId,
      user_id: profile.id,
      role_in_project: profile.role,
    });

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setEmail("");
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">協力会社・メンバー</h2>
      <ul className="mb-3 flex flex-wrap gap-2">
        {members.map((m) => (
          <li
            key={m.id}
            className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
          >
            {m.display_name}
            {m.company_name && `（${m.company_name}）`}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            required
            placeholder="メンバーの表示名で検索して追加"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            追加
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
