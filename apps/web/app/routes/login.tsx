import { useRef, useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import { SITE } from "@aihot/industry/site";
import { Button } from "../components/ui/Controls";
import { AccountField, AccountNotice } from "../features/account/fields";
import { accountErrorMessage, accountRequest } from "../features/account/client";
import { ACCOUNT_HEADERS, safeAccountReturn } from "../features/account/data";

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return { returnTo: safeAccountReturn(url.searchParams.get("return")), expired: url.searchParams.has("expired"), changed: url.searchParams.has("passwordChanged") };
}

export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `登录 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];

export default function Login() {
  const { returnTo, expired, changed } = useLoaderData<typeof loader>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  return <div className="mx-auto max-w-[420px] py-10 lg:py-14">
    <header className="mb-6"><h1 className="text-[26px] font-semibold text-ink">登录 {SITE.name}</h1><p className="mt-2 text-[14px] leading-relaxed text-ink-3">使用管理员为你创建的账号，登录后使用数据工具。</p></header>
    <form className="card space-y-5 p-5 sm:p-6" onSubmit={async event => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      setPending(true); setError(null);
      try {
        await accountRequest<AccountMe>("POST", "/api/account/login", { username: username.trim(), password });
        window.location.assign(returnTo);
      } catch (cause) {
        setError(accountErrorMessage(cause));
        submitting.current = false; setPending(false);
      }
    }}>
      <AccountNotice message={changed ? "密码已修改，请使用新密码重新登录。" : expired ? "登录已过期，请重新登录后继续。" : null} />
      <AccountField id="login-username" label="用户名" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} required value={username} onChange={event => setUsername(event.target.value)} />
      <AccountField id="login-password" label="密码" name="password" type="password" autoComplete="current-password" maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} />
      <AccountNotice error message={error} />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>{pending ? "正在登录…" : "登录"}</Button>
      <p className="text-[12.5px] leading-relaxed text-ink-4">忘记密码请联系管理员重置。</p>
    </form>
    <p className="mt-5 text-center text-[13px] text-ink-3">暂未开放自助注册。<Link to="/register" className="ml-1 text-accent hover:underline">账号开通说明</Link></p>
  </div>;
}
