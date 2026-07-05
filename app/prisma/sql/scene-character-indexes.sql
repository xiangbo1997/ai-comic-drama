-- 分镜角色关联索引（2026-07-05，a3 审计 P0-2）
--
-- 角色 usage 查询（删角色前的引用检查 /api/characters/[id]/usage）用
-- OR(selectedCharacterId=id, selectedCharacterIds @> [id]) 过滤 Scene，
-- Scene 是增长最快的表（项目×镜），两列此前均无索引 → 全表顺序扫。
--
-- selectedCharacterId 用普通 B-tree；selectedCharacterIds 是原生数组，
-- has(=@>包含) 查询需 GIN。Prisma schema 无法声明 GIN，用本 SQL 手建
-- （db push 后执行，IF NOT EXISTS 幂等可重复跑）。

CREATE INDEX IF NOT EXISTS "Scene_selectedCharacterId_idx"
  ON "Scene" ("selectedCharacterId");

CREATE INDEX IF NOT EXISTS "Scene_selectedCharacterIds_gin_idx"
  ON "Scene" USING GIN ("selectedCharacterIds");
