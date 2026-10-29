import { useRef, useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import { SITE } from "@aihot/industry/site";
import { Button, buttonClass } from "../components/ui/Controls";
import { accountGet } from "../lib/account.server";
import { AccountField, AccountNotice } from "../features/account/fields";
import { accountErrorMessage, accountRequest } from "../features/account/client";
import { ACCOUNT_HEADERS } from "../features/account/data";
import { AccountCredits } from "../features/account/credits";
import { usePrivateAccount } from "../features/account/use-private-account";

export const loader = ({ request }: LoaderFunctionArgs) => accountGet<AccountMe>(request, "/api/account/me");
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `我的账号 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];

export default function Account() {
  const initial = useLoaderData<typeof loader>();
  usePrivateAccount(initial);
  return <AccountContent key={`${initial.user.id}:${initial.csrf}`} initial={initial} />;
}

function AccountContent({ initial }: { initial: AccountMe }) {
  const [me, setMe] = useState(initial);
  const [displayName, setDisplayName] = useState(initial.user.displayName);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ scope: string; message: string; error: boolean } | null>(null);
  const submitting = useRef(false);
  async function command(scope: string, work: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true; setPending(scope); setNotice(null);
    try { await work(); } catch (error) { setNotice({ scope, message: accountErrorMessage(error), error: true }); }
    finally { submitting.current = false; setPending(null); }
  }
  return <div className="mx-auto max-w-[720px] pb-8 pt-5 lg:pt-1">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-[24px] font-semibold text-ink">我的账号</h1><p className="mt-1 text-[14px] text-ink-3">管理个人资料与登录密码。</p></div>
      <Link to="/tools" className={buttonClass("primary")}>使用数据工具</Link>
    </header>
    <section className="card mb-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-[18px] font-semibold text-ink">{me.user.displayName}</h2><p className="mt-1 text-[13px] text-ink-3">@{me.user.username} <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">普通用户</span></p></div>
        <Button disabled={!!pending} onClick={() => command("logout", async () => { await accountRequest("POST", "/api/account/logout", {}, me.csrf); window.location.assign("/login"); })}>{pending === "logout" ? "正在退出…" : "退出登录"}</Button>
      </div>
      {notice?.scope === "logout" && <div className="mt-4"><AccountNotice error={notice.error} message={notice.message} /></div>}
    </section>
    <div className="mb-5"><AccountCredits csrf={me.csrf} /></div>
    <div className="grid gap-5 sm:grid-cols-2">
      <form className="card space-y-5 p-5 sm:p-6" onSubmit={event => { event.preventDefault(); void command("profile", async () => {
        const result = await accountRequest<AccountMe>("PATCH", "/api/account/profile", { displayName: displayName.trim() }, me.csrf);
        setMe(result); setDisplayName(result.user.displayName);
        window.dispatchEvent(new Event("account-updated"));
        setNotice({ scope: "profile", message: "个人资料已保存。", error: false });
      }); }}>
        <h2 className="text-[16px] font-semibold text-ink">个人资料</h2>
        <AccountField id="account-display-name" label="昵称" name="displayName" autoComplete="nickname" required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} />
        <p className="text-[12.5px] leading-relaxed text-ink-4">用户名由管理员创建，昵称可自行修改。</p>
        {notice?.scope === "profile" && <AccountNotice error={notice.error} message={notice.message} />}
        <Button type="submit" variant="primary" disabled={!!pending || !displayName.trim()}>{pending === "profile" ? "正在保存…" : "保存资料"}</Button>
      </form>
      <form className="card space-y-5 p-5 sm:p-6" onSubmit={event => {
        event.preventDefault();
        if (newPassword !== confirmPassword) { setNotice({ scope: "password", error: true, message: "两次输入的新密码不一致。" }); return; }
        void command("password", async () => { await accountRequest("POST", "/api/account/password", { currentPassword, newPassword }, me.csrf); window.location.assign("/login?passwordChanged=1&return=%2Faccount"); });
      }}>
        <h2 className="text-[16px] font-semibold text-ink">修改密码</h2>
        <input type="text" name="username" autoComplete="username" value={me.user.username} readOnly hidden />
        <AccountField id="account-current-password" label="当前密码" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
        <AccountField id="account-new-password" label="新密码" hint="12–128 个字符，建议使用不重复的长密码。" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} />
        <AccountField id="account-confirm-password" label="确认新密码" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
        <p className="text-[12.5px] leading-relaxed text-ink-4">修改成功后，所有设备都需要使用新密码重新登录。</p>
        {notice?.scope === "password" && <AccountNotice error={notice.error} message={notice.message} />}
        <Button type="submit" variant="primary" disabled={!!pending}>{pending === "password" ? "正在修改…" : "更新密码"}</Button>
      </form>
    </div>
  </div>;
}
