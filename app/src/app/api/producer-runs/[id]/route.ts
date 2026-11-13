import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ProducerActionZ } from "@/lib/producer-run";
import {
  advanceProducerRun,
  readProducerRun,
  ProducerRunError,
} from "@/services/producer-runs";
import { createLogger } from "@/lib/logger";
const log = createLogger("api:producer-run");
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await readProducerRun(session.user.id, (await params).id)
    );
  } catch (error) {
    if (error instanceof ProducerRunError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    log.error("Read checkpoint failed", error);
    return NextResponse.json({ error: "读取草稿失败" }, { status: 500 });
  }
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = ProducerActionZ.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "草稿步骤参数无效" }, { status: 400 });
  try {
    return NextResponse.json(
      await advanceProducerRun(session.user.id, (await params).id, parsed.data)
    );
  } catch (error) {
    if (error instanceof ProducerRunError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    log.error("Advance checkpoint failed", error);
    return NextResponse.json(
      { error: "保存草稿步骤失败，请重试" },
      { status: 500 }
    );
  }
}
