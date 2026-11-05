import { z } from "zod";

/** Only explicit argument errors before external calls or writes are safe for model correction. */
export class DraftArgumentsError extends Error {
  readonly result: { error: string; fields: string[]; message: string; validSampleIds?: string[] };
  constructor(error: z.ZodError, correction?: string, research?: { validSampleIds: string[] }) {
    super("Invalid tool arguments");
    this.result = {
      error: "invalid_tool_arguments",
      fields: [...new Set(error.issues.map((issue) => issue.path.map(String).join(".") || "input"))].slice(0, 10),
      message: correction ?? "请按工具schema修正字段。新建稿件省略artifactId并使用baseVersion=0；修改仅使用已提供的稿件UUID与版本。不得重新检索。",
      ...(research ? { validSampleIds: research.validSampleIds } : {}),
    };
  }
}
