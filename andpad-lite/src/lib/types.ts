export type UserRole = "contractor" | "subcontractor";
export type ProjectStatus = "preparing" | "in_progress" | "completed" | "on_hold";
export type TaskStatus = "not_started" | "in_progress" | "done";

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  company_name: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  address: string | null;
  client_name: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  owner_id: string;
  created_at: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  assignee_id: string | null;
  start_date: string;
  end_date: string;
  status: TaskStatus;
  sort_order: number;
  created_at: string;
}

export interface Photo {
  id: string;
  project_id: string;
  task_id: string | null;
  storage_path: string;
  caption: string | null;
  uploaded_by: string;
  created_at: string;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  preparing: "準備中",
  in_progress: "進行中",
  completed: "完了",
  on_hold: "中断",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  done: "完了",
};
