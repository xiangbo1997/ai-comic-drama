import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  shortVideoUser,
  shortVideoBody,
  shortVideoError,
} from "@/lib/short-video/api";
import { shortVideoConfig } from "@/lib/short-video/config";
import { invariant, SvError } from "@/lib/short-video/errors";
import { streamMediaUpload } from "@/lib/short-video/upload";
import { capabilities } from "@/services/short-video/connectors";
import {
  importSource,
  listSources,
  createVideo,
  patchVideo,
  listVideos,
  videoDetail,
  listTemplates,
  saveTemplate,
  dto,
  ownedVideo,
} from "@/services/short-video/store";
import { saveScript } from "@/services/short-video/scripts";
import {
  createScriptPlan,
  createRenderPlan,
} from "@/services/short-video/plans";
import { readRun, controlRun } from "@/services/short-video/runs";
import {
  createAccount,
  listAccounts,
  disconnectAccount,
} from "@/services/short-video/accounts";
import {
  createPublication,
  patchPublication,
  readPublication,
  listPublications,
  controlPublication,
} from "@/services/short-video/publications";
import {
  createHotBrief,
  readHotBrief,
  latestHotBrief,
  saveHotIdea,
  saveAiHotBrief,
} from "@/services/short-video/hot-discovery/store";
import { addMetric, listMetrics } from "@/services/short-video/metrics";
import {
  createDiscovery,
  readDiscovery,
} from "@/services/short-video/discovery";
import {
  withMediaTemp,
  acceptUpload,
  artifactAccess,
} from "@/services/short-video/artifacts";
import { publicationExport } from "@/services/short-video/export";
import { workerHealth } from "@/services/short-video/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const log = createLogger("short-video:route");
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  try {
    const user = await shortVideoUser(request);
    if (user instanceof NextResponse) return user;
    const parts = z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(5)
      .parse((await context.params).path);
    const [, id, sub] = parts;
    const method = request.method;
    const query = Object.fromEntries(request.nextUrl.searchParams);
    const userId = user.id;
    const is = (m: string, pattern: string) =>
      m === method &&
      pattern.split("/").length === parts.length &&
      pattern.split("/").every((p, i) => p.startsWith(":") || p === parts[i]);
    const body = () => shortVideoBody(request);
    let result: unknown;
    let status = 200;
    if (is("GET", "capabilities"))
      result = {
        enabled: true,
        userId,
        autoSubmitEnabled: shortVideoConfig().autoSubmit,
        platforms: capabilities(),
        defaultTimeZone: shortVideoConfig().timeZone,
      };
    else if (is("GET", "models"))
      result = {
        items: await prisma.userAIConfig.findMany({
          where: { userId, isEnabled: true, provider: { isActive: true } },
          select: {
            id: true,
            selectedModel: true,
            provider: { select: { category: true, name: true } },
          },
        }),
        nextCursor: null,
      };
    else if (is("GET", "health")) {
      invariant(
        ["ADMIN", "SUPER_ADMIN"].includes(user.role),
        403,
        "ADMIN_ONLY",
        "仅管理员可查看worker状态"
      );
      result = await workerHealth();
    } else if (is("POST", "hot-briefs")) {
      result = await createHotBrief(userId, await body());
      status = 202;
    } else if (is("GET", "hot-briefs")) result = await latestHotBrief(userId);
    else if (is("GET", "hot-briefs/:id"))
      result = await readHotBrief(userId, id);
    else if (is("POST", "hot-briefs/:id/save-idea"))
      result = await saveHotIdea(userId, id, await body());
    else if (is("POST", "hot-briefs/:id/save-ai"))
      result = await saveAiHotBrief(userId, id, await body());
    else if (is("GET", "sources")) result = await listSources(userId, query);
    else if (is("POST", "sources/import"))
      result = await importSource(userId, await body());
    else if (is("POST", "discovery")) {
      result = await createDiscovery(userId, await body());
      if ((result as { status: string }).status === "BLOCKED")
        return NextResponse.json(
          {
            error: {
              code: "CONNECTOR_BLOCKED",
              message: "搜索来源尚未核验，未发起外部请求",
              retryable: false,
              details: result,
            },
            requestId,
          },
          { status: 503 }
        );
      status = 202;
    } else if (is("GET", "discovery/:id"))
      result = await readDiscovery(userId, id);
    else if (is("GET", "videos")) result = await listVideos(userId, query);
    else if (is("POST", "videos")) {
      result = await createVideo(userId, await body());
      status = 201;
    } else if (is("GET", "videos/:id")) result = await videoDetail(userId, id);
    else if (is("PATCH", "videos/:id"))
      result = await patchVideo(userId, id, await body());
    else if (is("GET", "templates"))
      result = await listTemplates(userId, query);
    else if (is("POST", "templates"))
      result = await saveTemplate(userId, undefined, await body());
    else if (is("PATCH", "templates/:id"))
      result = await saveTemplate(userId, id, await body());
    else if (is("POST", "videos/:id/scripts"))
      result = await saveScript(userId, id, await body());
    else if (
      is("POST", "videos/:id/script-runs") ||
      is("POST", "videos/:id/render-plans")
    ) {
      const ref =
        sub === "script-runs"
          ? await createScriptPlan(userId, id, await body())
          : await createRenderPlan(userId, id, await body());
      result = await readRun(userId, ref.id);
      status = 202;
    } else if (is("GET", "runs/:id")) result = await readRun(userId, id);
    else if (is("POST", "runs/:id/actions"))
      result = await controlRun(userId, id, await body());
    else if (is("POST", "videos/:id/artifacts/upload")) {
      await ownedVideo(userId, id);
      result = await withMediaTemp(async (dir) => {
        const file = path.join(dir, "upload");
        const upload = await streamMediaUpload(request, file);
        z.enum(["VIDEO", "COVER"]).parse(upload.kind);
        return acceptUpload(
          userId,
          id,
          upload.requestId,
          file,
          upload.kind,
          upload.rightsNote
        );
      });
      status = 201;
    } else if (is("GET", "artifacts/:id/access"))
      result = await artifactAccess(userId, id);
    else if (is("GET", "accounts")) result = await listAccounts(userId, query);
    else if (is("POST", "accounts"))
      result = await createAccount(userId, await body());
    else if (is("POST", "accounts/:id/disconnect"))
      result = await disconnectAccount(userId, id, await body());
    else if (
      is("POST", "accounts/connect") ||
      is("GET", "accounts/callback/:connector")
    )
      throw new SvError(
        503,
        "CONNECTOR_BLOCKED",
        "尚无经过验证的账号授权连接器；未创建自动账号"
      );
    else if (is("GET", "publications"))
      result = await listPublications(userId, query);
    else if (is("POST", "publications"))
      result = await createPublication(userId, await body());
    else if (is("GET", "publications/:id"))
      result = await readPublication(userId, id);
    else if (is("PATCH", "publications/:id"))
      result = await patchPublication(userId, id, await body());
    else if (is("POST", "publications/:id/actions"))
      result = await controlPublication(userId, id, await body());
    else if (is("GET", "publications/:id/metrics"))
      result = await listMetrics(userId, id, query);
    else if (is("POST", "publications/:id/metrics"))
      result = await addMetric(userId, id, await body());
    else if (is("GET", "publications/:id/export"))
      return new Response(await publicationExport(userId, id), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="short-video-${id.replace(/[^a-zA-Z0-9_-]/g, "")}.zip"`,
          "Cache-Control": "private, no-store",
        },
      });
    else throw new SvError(404, "NOT_FOUND", "接口不存在");
    if (method !== "GET")
      log.info("短视频操作完成", {
        requestId,
        userId,
        method,
        resource: parts.join("/"),
        status,
      });
    return NextResponse.json(dto(result), {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return shortVideoError(error, requestId);
  }
}
export { handle as GET, handle as POST, handle as PATCH };
