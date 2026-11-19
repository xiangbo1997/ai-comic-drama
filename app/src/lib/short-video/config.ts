import { getShortVideoEnv } from "@/lib/env";
type Env = Record<string, string | undefined>;
export function canAccessShortVideo(
  user: { id: string; role: string; status: string },
  env: Env = process.env
) {
  return (
    env.SHORT_VIDEO_ENABLED === "true" &&
    user.status === "ACTIVE" &&
    (["ADMIN", "SUPER_ADMIN"].includes(user.role) ||
      (env.SHORT_VIDEO_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .includes(user.id))
  );
}
export const shortVideoConfig = getShortVideoEnv;
