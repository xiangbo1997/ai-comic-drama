import { Client } from "pg";
import { readFile } from "node:fs/promises";
const raw = process.env.COMIC_POSTGRES_TEST_URL;
if (!raw) throw new Error("必须显式设置隔离库 COMIC_POSTGRES_TEST_URL");
const target = new URL(raw);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  !target.pathname.startsWith("/ai_comic_verify") ||
  process.env.SHORT_VIDEO_TEST_DB_SETUP !== "isolated-only"
)
  throw new Error("仅允许显式标记的本机隔离测试库");
const client = new Client({ connectionString: raw });
await client.connect();
try {
  const exists = await client.query(
    "SELECT to_regclass('public.\"User\"') AS present"
  );
  if (!exists.rows[0].present) {
    const baseline = await readFile(
      process.env.SHORT_VIDEO_TEST_BASELINE_SQL ||
        "/tmp/short-video-test-baseline.sql",
      "utf8"
    );
    await client.query(baseline.replace(/^\[dotenv.*\n/gm, ""));
    await client.query(
      "INSERT INTO \"User\" (id,email,\"inviteCode\",\"updatedAt\") VALUES ('sv-migration-sentinel','sv-migration@example.test','sv-migration-sentinel',now())"
    );
    console.log("隔离库：旧schema基线和模拟旧数据已建立");
  }
  await client.query(
    "CREATE TABLE IF NOT EXISTS sv_test_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const name = "20261119000000_add_short_video";
  const applied = await client.query(
    "SELECT name FROM sv_test_migrations WHERE name=$1",
    [name]
  );
  if (!applied.rowCount) {
    await client.query("BEGIN");
    try {
      await client.query(
        await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url
          ),
          "utf8"
        )
      );
      await client.query("INSERT INTO sv_test_migrations(name) VALUES ($1)", [
        name,
      ]);
      await client.query("COMMIT");
      console.log("隔离库：新增迁移已应用");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else console.log("隔离库：迁移已登记，重复部署不重复执行SQL");
  const sentinel = await client.query(
    "SELECT id FROM \"User\" WHERE id='sv-migration-sentinel'"
  );
  if (sentinel.rowCount !== 1) throw new Error("旧数据丢失");
  console.log("隔离库验证通过；未读取应用 DATABASE_URL");
} finally {
  await client.end();
}
