import { Link } from "react-router";
import { SITE } from "@aihot/industry/site";
import { buttonClass } from "../components/ui/Controls";
import { ACCOUNT_HEADERS } from "../features/account/data";

export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `账号开通 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];

export default function Register() {
  return <div className="mx-auto max-w-[480px] py-12 lg:py-20">
    <div className="card p-6 sm:p-8">
      <p className="text-[12px] font-medium text-accent">账号开通</p>
      <h1 className="mt-2 text-[24px] font-semibold text-ink">暂未开放自助注册</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-3">目前账号由管理员统一创建。请联系管理员获取用户名和初始密码，登录后可在「我的账号」修改密码。</p>
      <Link to="/login" className={`${buttonClass("primary")} mt-6`}>已有账号，前往登录</Link>
    </div>
  </div>;
}
