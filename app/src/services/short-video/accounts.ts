import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { AccountZ, VersionZ } from "@/lib/short-video/contracts";
import { invariant } from "@/lib/short-video/errors";
import { capabilities } from "./connectors";
import { page, pageArgs, receipt, json, type Tx } from "./store";
export const accountSelect = {
  id: true,
  platform: true,
  externalAccountId: true,
  displayName: true,
  version: true,
  mode: true,
  status: true,
  connectorId: true,
  credentialExpiresAt: true,
  capabilitySnapshot: true,
  lastVerifiedAt: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
export async function ownedAccount(
  userId: string,
  id: string,
  tx: Tx = prisma
) {
  const row = await tx.svAccount.findFirst({
    where: { id, userId },
    select: accountSelect,
  });
  invariant(row, 404, "NOT_FOUND", "发布账号不存在");
  return row;
}
export async function listAccounts(
  userId: string,
  params: Record<string, unknown>
) {
  const args = pageArgs(params);
  return page(
    await prisma.svAccount.findMany({
      ...args,
      where: { ...args.where, userId },
      select: accountSelect,
    }),
    args.take
  );
}
export async function createAccount(userId: string, raw: unknown) {
  const input = AccountZ.parse(raw);
  const ref = await receipt(userId, "account:create", input, async (tx) => ({
    id: (
      await tx.svAccount.create({
        data: {
          userId,
          platform: input.platform,
          displayName: input.displayName,
          externalAccountId: `manual:${randomUUID()}`,
          mode: "MANUAL",
          status: "MANUAL",
          capabilitySnapshot: json(
            capabilities().find((c) => c.platform === input.platform)
          ),
        },
      })
    ).id,
  }));
  return ownedAccount(userId, ref.id);
}
export async function disconnectAccount(
  userId: string,
  id: string,
  raw: unknown
) {
  const input = VersionZ.strict().parse(raw);
  await receipt(userId, `account:${id}:disconnect`, input, async (tx) => {
    await ownedAccount(userId, id, tx);
    invariant(
      (
        await tx.svAccount.updateMany({
          where: { id, userId, version: input.expectedVersion },
          data: {
            disabledAt: new Date(),
            status: "REVOKED",
            credentialCiphertext: null,
            credentialIv: null,
            version: { increment: 1 },
          },
        })
      ).count
    );
    return { id };
  });
  return ownedAccount(userId, id);
}
