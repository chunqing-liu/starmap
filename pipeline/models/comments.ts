export const PIPELINE_COMMENTS_KEY_PREFIX = "pipeline_comments_v1";

export type PipelineCommentTargetType = "station" | "node";

export interface PipelineComment {
  id: string;
  targetType: PipelineCommentTargetType;
  targetId: string;
  author: string;
  content: string;
  createdAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const commentKey = (demandId: string) =>
  `${PIPELINE_COMMENTS_KEY_PREFIX}:${encodeURIComponent(demandId)}`;

function normalizeComment(value: unknown): PipelineComment | null {
  if (!isRecord(value)) return null;
  const targetType = value.targetType;
  if (
    typeof value.id !== "string" || !value.id ||
    (targetType !== "station" && targetType !== "node") ||
    typeof value.targetId !== "string" || !value.targetId ||
    typeof value.author !== "string" || !value.author ||
    typeof value.content !== "string" || !value.content.trim() ||
    typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))
  ) return null;
  return {
    id: value.id,
    targetType,
    targetId: value.targetId,
    author: value.author,
    content: value.content.trim(),
    createdAt: value.createdAt,
  };
}

export function loadPipelineComments(demandId: string): PipelineComment[] {
  if (!demandId) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(commentKey(demandId)) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeComment).filter((comment): comment is PipelineComment => Boolean(comment));
  } catch {
    // 评论缓存损坏时只忽略评论，不影响主星图和旧版本数据恢复。
    return [];
  }
}

export function savePipelineComments(demandId: string, comments: PipelineComment[]) {
  if (!demandId) return;
  try {
    localStorage.setItem(commentKey(demandId), JSON.stringify(comments));
  } catch {
    // localStorage 不可写时保持当前会话可用，不阻塞星图编辑。
  }
}
