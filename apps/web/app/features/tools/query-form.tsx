import { useState, type ReactNode } from "react";
import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
import { Button, Input, Select } from "../admin/ui";
import { ToolField as Field } from "./fields";
import { defaultPlatformValues, platformParameters } from "../admin/platform-types";

export function QueryForm({ operations, pending, submit }: { operations: PlatformOperationDescriptor[]; pending: boolean; submit: (kind: string, body: unknown) => Promise<void> }) {
  const [platform, setPlatform] = useState(operations[0]?.platform ?? "");
  const choices = operations.filter(operation => operation.platform === platform);
  const [id, setId] = useState("");
  const operation = choices.find(choice => choice.id === id) ?? choices[0];
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="平台"><Select value={platform} onChange={event => { setPlatform(event.target.value); setId(""); }}>{[...new Set(operations.map(row => row.platform))].map(value => <option key={value} value={value}>{PLATFORM_LABELS[value] ?? value}</option>)}</Select></Field>
      <Field label="查询内容"><Select value={operation?.id ?? ""} onChange={event => setId(event.target.value)}>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</Select></Field>
    </div>
    {operation ? <OperationForm key={operation.id} operation={operation} pending={pending} submit={submit} /> : <p className="text-ink-3">暂无可用工具。</p>}
  </div>;
}

function OperationForm({ operation, pending, submit }: { operation: PlatformOperationDescriptor; pending: boolean; submit: (kind: string, body: unknown) => Promise<void> }) {
  const [values, setValues] = useState(() => defaultPlatformValues(operation));
  const [error, setError] = useState<string | null>(null);
  const providers = operation.queryProviders ?? [{ id: operation.id.includes(".") ? "agentkey" : "redfox", label: operation.id.includes(".") ? "AgentKey" : "Redfox" }];
  const [provider, setProvider] = useState(providers[0]?.id ?? "redfox");
  const variant = providers.find(value => value.id === provider);
  const selected = variant?.fields ? { ...operation, fields: variant.fields } : operation;
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setError(null);
    try {
      const basic = { ...selected, fields: selected.fields.filter(field => !field.type.endsWith("-array")) };
      const parameters: Record<string, unknown> = platformParameters(basic, values);
      for (const field of selected.fields.filter(field => field.type.endsWith("-array"))) {
        const items = (values[field.name] ?? "").split(/[,，\n]/).map(value => value.trim()).filter(Boolean);
        if (!items.length) { if (field.required) throw new Error(`请填写${field.label}`); continue; }
        if (field.type === "integer-array" && items.some(value => !Number.isSafeInteger(Number(value)))) throw new Error(`${field.label}请填写整数列表`);
        parameters[field.name] = field.type === "integer-array" ? items.map(Number) : items;
      }
      await submit("query", { provider, operationId: operation.id, parameters });
    }
    catch (error) { setError(error instanceof Error ? error.message : "请检查查询参数。"); }
  }}>
    {providers.length > 1 && <Field label="数据供应商"><Select value={provider} onChange={event => { setProvider(event.target.value); const next = providers.find(value => value.id === event.target.value); setValues(defaultPlatformValues(next?.fields ? { ...operation, fields: next.fields } : operation)); }}>{providers.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</Select></Field>}
    {selected.fields.map(field => {
      let control: ReactNode;
      const value = values[field.name] ?? "";
      const update = (value: string) => setValues(previous => ({ ...previous, [field.name]: value }));
      if (field.type === "select" || field.type === "boolean") control = <Select value={value} required={field.required} onChange={event => update(event.target.value)}><option value="">请选择</option>{(field.type === "boolean" ? [{ value: "true", label: "是" }, { value: "false", label: "否" }] : field.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
      else control = <Input value={value} required={field.required} type={field.type === "integer" ? "number" : "text"} min={field.constraints?.min} max={field.constraints?.max} step={field.constraints?.step} maxLength={field.constraints?.maxLength} onChange={event => update(event.target.value)} />;
      return <Field key={field.name} label={field.label} hint={`${field.hint ?? ""}${field.type.endsWith("-array") ? "（多项用逗号分隔）" : ""}`}>{control}</Field>;
    })}
    {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    <Button type="submit" tone="primary" busy={pending} disabled={pending}>查看积分报价</Button>
  </form>;
}

const PLATFORM_LABELS: Record<string, string> = { x: "X", "x-research": "X", "hot-research": "热点榜单", weibo: "微博", wechat: "微信", douyin: "抖音", xiaohongshu: "小红书", tiktok: "TikTok", bilibili: "哔哩哔哩", youtube: "YouTube", instagram: "Instagram", shipinhao: "视频号", kuaishou: "快手", toutiao: "今日头条", zhihu: "知乎", baijiahao: "百家号", qichezhijia: "汽车之家", dongchedi: "懂车帝", yiche: "易车", tools: "辅助工具", baidu: "百度", hot: "热点榜单" };
