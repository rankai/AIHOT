import { useCallback, useEffect, useState } from 'react';
import type { MembershipPage, MemberPriceCatalog } from '@aihot/contracts/membership';
import { Button, Input, Select, Textarea } from '../admin/ui';
import { useAdminAction } from '../admin/action';
import { AccountNotice } from './fields';

function useMembership(path: string) {
 const [page,setPage] = useState<MembershipPage | null>(null), [error,setError] = useState<string | null>(null);
 const refresh = useCallback(async () => {
  try { const response = await fetch(path,{credentials:'same-origin',cache:'no-store'}); const body = await response.json(); if (!response.ok) throw new Error(body.detail ?? '会员信息读取失败'); setPage(body); setError(null); }
  catch(error) { setError(error instanceof Error ? error.message : '会员信息读取失败'); }
 },[path]);
 useEffect(() => { void refresh(); },[refresh]);
 return {page,error,refresh};
}
function MembershipStatus({page}: {page: MembershipPage}) {
 const membership = page.membership;
 return <p className="my-4 text-[13px] text-ink-2">{membership ? `${page.plans.find(plan => plan.id === membership.planId)?.name}会员 · ${membership.status === 'active' ? '生效中' : '已到期'} · 到期时间 ${new Date(membership.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}` : '尚未开通月费套餐'}</p>;
}
function PaymentHistory({page,admin=false}: {page: MembershipPage; admin?: boolean}) {
 return <details className="mt-4 text-[13px]"><summary className="cursor-pointer">收款与发分记录（最近 100 笔）</summary><div className="mt-3 space-y-3">{page.payments.length ? page.payments.map(payment => <div className="rounded-control border border-line p-3" key={payment.id}><p>¥{payment.amountFen / 100} · +{payment.credits.toLocaleString()} 积分</p><p className="text-ink-3">{new Date(payment.periodStart).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})} 至 {new Date(payment.periodEnd).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>{admin && <p className="break-all text-ink-3">收款编号：{payment.receiptReference} · {payment.reason}</p>}</div>) : <p>暂无收款记录。</p>}</div></details>;
}
export function AccountMembership() {
 const {page,error,refresh} = useMembership('/api/account/membership');
 return <section className="card mb-5 p-5 sm:p-6"><div className="flex justify-between gap-3"><h2 className="font-semibold">月费会员</h2><Button size="sm" onClick={() => void refresh()}>刷新会员</Button></div><AccountNotice error message={error}/>{page && <><MembershipStatus page={page}/><div className="grid gap-3 md:grid-cols-3">{page.plans.map(plan => <div key={plan.id} className="rounded-control border border-line p-4"><h3 className="font-semibold">{plan.name}</h3><p className="my-2 text-2xl">¥{plan.amountFen/100}<span className="text-xs text-ink-3"> / 月</span></p><p>{plan.credits.toLocaleString()} 积分 / 期</p><p className="mt-3 text-xs text-ink-3">联系管理员办理线下付款，确认到账后开通。</p></div>)}</div><p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">每次确认收款延长一个日历月，月末日期自动截断。有效期内仅续原套餐，到期后可换档。已发积分不清零，到期仍可使用；不会自动扣费或续费。</p><PaymentHistory page={page}/></>}</section>;
}
export function AdminMembership({userId,onChanged}: {userId:number;onChanged:()=>Promise<void>}) {
 const {page,error,refresh} = useMembership(`/api/admin/users/${userId}/membership`);
 const {run,pending} = useAdminAction();
 const [planId,setPlan] = useState('basic'), [reference,setReference] = useState(''), [reason,setReason] = useState(''), [received,setReceived] = useState(false);
 useEffect(() => { if (page?.membership?.status === 'active') setPlan(page.membership.planId); }, [page]);
 return <section className="mb-6 border-b border-line pb-5"><h3 className="font-semibold">月费套餐 · 线下收款确认</h3><AccountNotice error message={error}/>{page && <><MembershipStatus page={page}/><form className="space-y-3" onSubmit={async event => {event.preventDefault();const result = await run('POST',`/api/admin/users/${userId}/membership`,{planId,receiptReference:reference,reason,received},{success:'收款已确认，会员周期和积分已更新'});if(result){setReference('');setReason('');setReceived(false);await refresh();await onChanged();}}}><label className="block text-sm">套餐<Select value={planId} onChange={event => setPlan(event.target.value)}>{page.plans.map(plan => <option key={plan.id} value={plan.id} disabled={page.membership?.status === 'active' && page.membership.planId !== plan.id}>{plan.name} · ¥{plan.amountFen/100} · {plan.credits.toLocaleString()} 积分</option>)}</Select></label><label className="block text-sm">唯一外部收款编号<Input required minLength={3} maxLength={160} value={reference} onChange={event => setReference(event.target.value)} /></label><label className="block text-sm">收款说明<Textarea required minLength={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={received} onChange={event => setReceived(event.target.checked)}/>我已核实收到所选套餐的全额款项</label><p className="text-xs text-ink-3">有效期内仅续原套餐；每笔收款延长一月。不要在说明中填写密钥或支付账户秘密。</p><Button type="submit" tone="primary" disabled={!received || !!pending} busy={!!pending}>确认收款并发放积分</Button></form><PaymentHistory page={page} admin/></>}</section>;
}
export function MemberPriceTable({catalog,admin=false}: {catalog:MemberPriceCatalog;admin?:boolean}) {
 return <details className="card mb-5 p-4"><summary className="cursor-pointer font-semibold">{admin ? '已批准价目与供应商成本依据' : '工具价格与开放范围'}</summary><p className="my-3 text-xs text-ink-3">当前售价来自工具积分规则。参数条件可能影响扣分，提交前以服务端确认为准；未配置不开放。素材上传和正常恢复不追加收费。</p><div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr><th className="p-2">工具 / 规格</th><th className="p-2">当前扣分</th>{admin && <th className="p-2">批准价 / 成本依据</th>}</tr></thead><tbody>{catalog.offers.map(offer => <tr className="border-t border-line" key={[offer.kind,offer.provider,offer.model,offer.tier].join(':')}><td className="p-2">{offer.label}<p className="text-ink-3">{offer.restriction}</p></td><td className="p-2">{offer.prices?.length ? offer.prices.map(price => <p key={price.id}>{price.baseCredits}{price.imageCredits > 0 ? ` + ${price.imageCredits}/张` : ''}{price.videoSecondCredits > 0 ? ` + ${price.videoSecondCredits}/输入秒` : ''}{price.referenceCredits > 0 ? ` + ${price.referenceCredits}/参考图` : ''} 积分{Object.keys(price.parameterMatch).length > 0 && <span className="block break-all text-ink-3">条件：{admin ? JSON.stringify(price.parameterMatch) : Object.entries(price.parameterMatch).map(([key,value]) => key === 'n' ? `${value} 张图片` : key === 'duration' ? `${value} 秒` : key === 'generateAudio' ? value ? '有声' : '无声' : '特定参数（以报价确认为准）').join('、')}</span>}</p>) : '尚未配置'}</td>{admin && <td className="p-2">{offer.credits} / {offer.unit}<p className="max-w-xs break-words text-ink-3">{offer.costBasis}</p></td>}</tr>)}</tbody></table></div><ul className="mt-4 space-y-2 text-xs text-ink-3">{catalog.unavailable.map(item => <li key={item}>{item}</li>)}</ul></details>;
}
