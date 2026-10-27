import type { PlatformOperationDescriptor as PlatformOperation } from "@aihot/contracts/redfox";
export type { PlatformField, PlatformOperationDescriptor as PlatformOperation } from "@aihot/contracts/redfox";
export function defaultPlatformValues(operation: PlatformOperation): Record<string, string> {
  return Object.fromEntries(operation.fields.map(field => [field.name, field.default === undefined ? "" : String(field.default)]));
}
export function platformParameters(operation: PlatformOperation, values: Record<string, string>): Record<string, string | number | boolean> {
  const parameters: Record<string, string | number | boolean> = {};
  for (const field of operation.fields) {
    const value = (values[field.name] ?? "").trim();
    if (!value) { if (field.required) throw new Error(`请填写${field.label}`); continue; }
    if (field.type === "boolean") {
      if (!["true", "false"].includes(value)) throw new Error(`请选择有效的${field.label}`);
      parameters[field.name] = value === "true";
      continue;
    }
    const constraints = field.constraints;
    if (constraints?.pattern && !new RegExp(constraints.pattern).test(value)) throw new Error(`${field.label}格式不正确`);
    if (constraints?.maxLength !== undefined && value.length > constraints.maxLength) throw new Error(`${field.label}过长`);
    if (field.type === "select" && !field.options?.some(option => option.value === value)) throw new Error(`请选择有效的${field.label}`);
    if (field.type === "integer" || constraints?.min !== undefined || constraints?.max !== undefined) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || (constraints?.min !== undefined && number < constraints.min) || (constraints?.max !== undefined && number > constraints.max)) throw new Error(`${field.label}须为允许范围内的安全整数`);
      if (constraints?.step !== undefined && (number - (constraints.min ?? 0)) % constraints.step !== 0) throw new Error(`${field.label}须按 ${constraints.step} 递增`);
    }
    parameters[field.name] = field.type === "integer" ? Number(value) : value;
  }
  return parameters;
}
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
