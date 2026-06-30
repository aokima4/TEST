import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABEL } from "@/lib/types";
import type { Project } from "@/lib/types";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">案件一覧</h1>
        <Link
          href="/projects/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          新規案件作成
        </Link>
      </div>

      {!projects || projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
          まだ案件がありません。「新規案件作成」から作成してください。
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
              >
                <div className="mb-2 flex items-start justify-between">
                  <h2 className="font-medium text-zinc-900">{project.name}</h2>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {PROJECT_STATUS_LABEL[project.status]}
                  </span>
                </div>
                {project.address && (
                  <p className="text-sm text-zinc-500">{project.address}</p>
                )}
                {project.client_name && (
                  <p className="mt-1 text-sm text-zinc-500">施主: {project.client_name}</p>
                )}
                {(project.start_date || project.end_date) && (
                  <p className="mt-1 text-xs text-zinc-400">
                    {project.start_date ?? "未定"} 〜 {project.end_date ?? "未定"}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
