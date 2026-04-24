/**
 * Workflow Artifact Store（Stage 3.3 拆分）
 *
 * Artifact 是 agent 间传递的数据单元。当前实现为 in-memory map；
 * 每步完成后由 workflow-engine 调用 `toJSON()` 刷写到 DB 的 WorkflowRun.artifacts 字段。
 *
 * 未来可替换为：
 * - Redis 备份 store（跨进程恢复）
 * - PostgreSQL JSONB store（更强审计能力）
 */

import type { ArtifactStore, Artifact, ArtifactType } from "./types";

export class InMemoryArtifactStore implements ArtifactStore {
  private store = new Map<string, Artifact>();

  get<T>(type: ArtifactType, id?: string): Artifact<T> | undefined {
    const key = id ? `${type}:${id}` : type;
    return this.store.get(key) as Artifact<T> | undefined;
  }

  set<T>(artifact: Artifact<T>): void {
    const key = artifact.id ? `${artifact.type}:${artifact.id}` : artifact.type;
    this.store.set(key, artifact as Artifact);
  }

  getAll<T>(type: ArtifactType): Artifact<T>[] {
    const results: Artifact<T>[] = [];
    for (const [key, value] of this.store) {
      if (key.startsWith(type)) {
        results.push(value as Artifact<T>);
      }
    }
    return results;
  }

  /** 序列化为 JSON（持久化用） */
  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      obj[key] = value;
    }
    return obj;
  }
}
