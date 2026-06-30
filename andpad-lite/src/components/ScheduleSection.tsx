"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TASK_STATUS_LABEL } from "@/lib/types";
import type { ProjectTask, TaskStatus, Profile } from "@/lib/types";

const STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: "bg-zinc-100 text-zinc-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

export function ScheduleSection({
  projectId,
  tasks,
  members,
}: {
  projectId: string;
  tasks: ProjectTask[];
  members: Profile[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase.from("tasks").insert({
      project_id: projectId,
      title,
      assignee_id: assigneeId || null,
      start_date: startDate,
      end_date: endDate,
      sort_order: tasks.length,
    });

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setTitle("");
    setAssigneeId("");
    setStartDate("");
    setEndDate("");
    router.refresh();
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    await supabase.from("tasks").update({ status }).eq("id", taskId);
    router.refresh();
  }

  const sorted = [...tasks].sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">工程表</h2>

      <form
        onSubmit={handleAdd}
        className="mb-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-5"
      >
        <input
          required
          placeholder="工程名（例: 基礎工事）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="">担当未定</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <input
          required
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 sm:col-span-5"
        >
          {loading ? "追加中..." : "工程を追加"}
        </button>
        {error && <p className="text-sm text-red-600 sm:col-span-5">{error}</p>}
      </form>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500">
          工程がまだ登録されていません。
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((task) => {
            const assignee = members.find((m) => m.id === task.assignee_id);
            return (
              <li
                key={task.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-zinc-900">{task.title}</p>
                  <p className="text-xs text-zinc-500">
                    {task.start_date} 〜 {task.end_date}
                    {assignee && ` ・ 担当: ${assignee.display_name}`}
                  </p>
                </div>
                <select
                  value={task.status}
                  onChange={(e) => handleStatusChange(task.id, e.target.value as TaskStatus)}
                  className={`rounded-full border-0 px-3 py-1 text-xs font-medium ${STATUS_COLOR[task.status]}`}
                >
                  {Object.entries(TASK_STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
