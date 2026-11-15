import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// 只暴露仓库技能目录，不允许模型指定主机路径或读取配置、密钥。
const roots = [
  path.join(process.cwd(), "../.claude/skills"),
  path.join(process.cwd(), "../.agents/skills"),
];
async function catalog() {
  const skills = new Map<
    string,
    { name: string; description: string; file: string }
  >();
  for (const root of roots) {
    // 技能已由 next.config 显式收录，禁止动态追踪把整个仓库打包。
    const entries = await readdir(/* turbopackIgnore: true */ root, {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries.slice(0, 60)) {
      if (
        !entry.isDirectory() ||
        !/^[a-z0-9-]+$/.test(entry.name) ||
        skills.has(entry.name)
      )
        continue;
      const file = path.join(root, entry.name, "SKILL.md");
      const text = await readFile(
        /* turbopackIgnore: true */ file,
        "utf8"
      ).catch(() => "");
      if (!text) continue;
      skills.set(entry.name, {
        name: entry.name,
        description:
          text.match(/^description:\s*(.+)$/m)?.[1]?.slice(0, 600) ??
          entry.name,
        file,
      });
    }
  }
  return skills;
}
export async function listAssistantSkills() {
  return [...(await catalog()).values()].map(({ name, description }) => ({
    name,
    description,
  }));
}
export async function readAssistantSkill(name: string) {
  const skill = (await catalog()).get(name);
  if (!skill) throw new Error("项目技能不存在");
  const text = await readFile(/* turbopackIgnore: true */ skill.file, "utf8");
  return {
    name,
    content: text.slice(0, 16_000),
    truncated: text.length > 16_000,
  };
}
