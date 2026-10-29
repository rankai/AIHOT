import { useState } from "react";
import { Form, Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { SiteUser } from "@aihot/contracts/account";
import { SITE } from "@aihot/industry/site";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, DataTable, Time } from "../../features/admin/ui";
import { AccountField, AccountNotice } from "../../features/account/fields";
import { ACCOUNT_HEADERS } from "../../features/account/data";
import { AdminUserCredits } from "../../features/admin/user-credits";

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const query = new URLSearchParams();
  if (url.searchParams.has("q")) query.set("q", url.searchParams.get("q")!);
  if (url.searchParams.has("cursor")) query.set("cursor", url.searchParams.get("cursor")!);
  return adminGet<{ users: SiteUser[]; nextCursor: number | null }>(request, `/api/admin/users?${query}`);
};
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `用户管理 · ${SITE.name} 后台` }, { name: "robots", content: "noindex, nofollow" }];

function UserEditor({ user, onClose }: { user: SiteUser; onClose: () => void }) {
  const { run, pending } = useAdminAction();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  return <Card title={`管理 @${user.username}`} right={<Button size="sm" disabled={!!pending} onClick={onClose}>收起</Button>}>
    <div className="grid gap-6 md:grid-cols-2">
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); setNotice(null);
        const result = await run<SiteUser>("PATCH", `/api/admin/users/${user.id}`, { displayName: displayName.trim() }, { label: "profile", success: "用户资料已保存" });
        if (result) setNotice("用户资料已保存。");
      }}>
        <AccountField id={`user-name-${user.id}`} label="昵称" required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} />
        <Button type="submit" disabled={!!pending || !displayName.trim()} busy={pending === "profile"}>保存昵称</Button>
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">停用后，该用户当前的登录会话会立即失效。重新启用后可再次登录。</p>
          <Button tone={user.status === "active" ? "danger" : "primary"} disabled={!!pending} busy={pending === "status"} onClick={async () => {
            setNotice(null);
            const status = user.status === "active" ? "disabled" : "active";
            const result = await run<SiteUser>("PATCH", `/api/admin/users/${user.id}`, { status }, { label: "status", success: status === "disabled" ? "用户已停用" : "用户已启用" });
            if (result) setNotice(status === "disabled" ? "用户已停用，登录会话已撤销。" : "用户已启用，可以使用原密码登录。");
          }}>{user.status === "active" ? "停用账号" : "启用账号"}</Button>
        </div>
      </form>
      <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); setNotice(null);
        const result = await run("POST", `/api/admin/users/${user.id}/password`, { password }, { label: "password", success: "密码已重置，所有登录会话已撤销" });
        if (result) { setPassword(""); setNotice("密码已重置。请通过安全渠道把新密码告知用户。"); }
      }}>
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <AccountField id={`user-password-${user.id}`} label="重置登录密码" hint="12–128 个字符。重置后所有设备需要重新登录。" type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
        <Button type="submit" disabled={!!pending} busy={pending === "password"}>重置密码</Button>
      </form>
    </div>
    {notice && <div className="mt-4"><AccountNotice message={notice} /></div>}
  </Card>;
}

export default function UsersAdmin() {
  const { users, nextCursor } = useLoaderData<typeof loader>();
  const [search, setSearch] = useSearchParams();
  const { run, pending } = useAdminAction();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = users.find(user => user.id === selectedId);
  return <AdminPage title="用户管理" subtitle="账号由后台创建。用户可以在前台登录、管理个人资料并使用数据工具；自助注册暂未开放。">
    <div className="space-y-5">
      <Card title="新增用户">
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setNotice(null);
          const result = await run<SiteUser>("POST", "/api/admin/users", { username: username.trim(), displayName: displayName.trim(), password }, { label: "create", success: "用户已创建" });
          if (result) { setUsername(""); setDisplayName(""); setPassword(""); setSelectedId(result.id); setSearch({}); setNotice(`账号 @${result.username} 已创建，可从前台登录。请通过安全渠道将账号与初始密码告知用户。`); }
        }}>
          <div className="grid gap-4 md:grid-cols-3">
            <AccountField id="new-user-username" label="用户名" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" hint="3–32 位，字母或数字开头，可含点、下划线和连字符；不区分大小写。" value={username} onChange={event => setUsername(event.target.value)} />
            <AccountField id="new-user-display-name" label="昵称" name="displayName" autoComplete="off" required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} />
            <AccountField id="new-user-password" label="初始密码" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="12–128 个字符，用户登录后可自行修改。" value={password} onChange={event => setPassword(event.target.value)} />
          </div>
          <AccountNotice message={notice} />
          <Button type="submit" tone="primary" disabled={!!pending} busy={pending === "create"}>创建用户</Button>
        </form>
      </Card>
      <Form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1"><AccountField id="user-search" name="q" label="查找用户" defaultValue={search.get("q") ?? ""} maxLength={80} placeholder="用户名或昵称" /></div>
        <Button type="submit">搜索</Button><Link to="/admin/users" className="py-2 text-[13px] text-accent">显示全部</Link>
      </Form>
      <Card title={`用户（本页 ${users.length}）`} pad={false}>
        <DataTable rows={users} rowKey={user => user.id} empty="还没有用户，在上方创建第一个账号。" columns={[
          { key: "name", label: "账号", render: user => <div><div className="font-medium text-ink">{user.displayName}</div><div className="mt-0.5 text-[12px] text-ink-4">@{user.username}</div></div> },
          { key: "role", label: "身份", render: () => "普通用户" },
          { key: "status", label: "状态", render: user => <Badge tone={user.status === "active" ? "ok" : "muted"}>{user.status === "active" ? "启用" : "停用"}</Badge> },
          { key: "created", label: "创建时间", render: user => <Time at={user.createdAt} /> },
          { key: "lastLogin", label: "最近登录", render: user => user.lastLoginAt ? <Time at={user.lastLoginAt} /> : "尚未登录" },
          { key: "actions", label: "操作", render: user => <Button size="sm" onClick={() => setSelectedId(user.id)}>管理</Button> },
        ]} />
      </Card>
      {nextCursor && <Link to={`/admin/users?${new URLSearchParams({ q: search.get("q") ?? "", cursor: String(nextCursor) })}`} className="text-[13px] text-accent">下一页 →</Link>}
      {selected && <><UserEditor key={selected.id} user={selected} onClose={() => setSelectedId(null)} /><AdminUserCredits key={`credits:${selected.id}`} userId={selected.id} /></>}
    </div>
  </AdminPage>;
}
