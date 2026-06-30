import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PROJECT_STATUS_LABEL } from "@/lib/types";
import type { Project, ProjectTask, Photo, Profile } from "@/lib/types";
import { ScheduleSection } from "@/components/ScheduleSection";
import { PhotoSection } from "@/components/PhotoSection";
import { MemberSection } from "@/components/MemberSection";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .returns<Project[]>()
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: tasks }, { data: photos }, { data: memberRows }] = await Promise.all([
    supabase.from("tasks").select("*").eq("project_id", id).returns<ProjectTask[]>(),
    supabase.from("photos").select("*").eq("project_id", id).returns<Photo[]>(),
    supabase
      .from("project_members")
      .select("user_id, profiles(*)")
      .eq("project_id", id),
  ]);

  const memberProfiles: Profile[] = (memberRows ?? [])
    .map((row) => (row as unknown as { profiles: Profile }).profiles)
    .filter(Boolean);

  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", project.owner_id)
    .maybeSingle<Profile>();

  const allMembers = ownerProfile
    ? [ownerProfile, ...memberProfiles.filter((m) => m.id !== ownerProfile.id)]
    : memberProfiles;

  const photoUrls: Record<string, string> = {};
  if (photos && photos.length > 0) {
    const paths = photos.map((p) => p.storage_path);
    const { data: signedUrls } = await supabase.storage
      .from("project-photos")
      .createSignedUrls(paths, 60 * 60);
    signedUrls?.forEach((entry, i) => {
      if (entry.signedUrl) photoUrls[photos[i].id] = entry.signedUrl;
    });
  }

  const isOwner = user?.id === project.owner_id;

  return (
    <div className="space-y-10">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900">{project.name}</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
        </div>
        <dl className="grid gap-1 text-sm text-zinc-600 sm:grid-cols-2">
          {project.address && (
            <div>
              <dt className="inline font-medium text-zinc-700">現場住所: </dt>
              <dd className="inline">{project.address}</dd>
            </div>
          )}
          {project.client_name && (
            <div>
              <dt className="inline font-medium text-zinc-700">施主: </dt>
              <dd className="inline">{project.client_name}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium text-zinc-700">着工日: </dt>
            <dd className="inline">{project.start_date ?? "未定"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-700">竣工予定日: </dt>
            <dd className="inline">{project.end_date ?? "未定"}</dd>
          </div>
        </dl>
      </div>

      <MemberSection projectId={project.id} members={allMembers} isOwner={isOwner} />
      <ScheduleSection projectId={project.id} tasks={tasks ?? []} members={allMembers} />
      <PhotoSection
        projectId={project.id}
        photos={photos ?? []}
        tasks={tasks ?? []}
        photoUrls={photoUrls}
      />
    </div>
  );
}
