# M4 小红书封面设计：受控适配入口

先通过 read_skill_reference 读取完整 core-workflow 资源，再按原规程完成必要内容判断。原文业务规程保留；以下运行合同覆盖其中与本系统执行方式冲突的命令和供应商调用，不执行脚本、shell或原生下载。

- fetch_explosive_covers.py 对应 search_xhs_covers：1–5个去重关键词，总Unicode≤200；默认冻结近30天，T+1数据，供应商只有startDate，不能声称支持任意endDate。一次父任务仅查询一次，须独立报价和人工批准，不自动换词、扩期或补足样本。
- 从真实候选元数据按主题相关性优先、互动辅助，选择最多20个sourceId并给简短理由，调用 analyze_xhs_covers，人工批准后才读取真实图片。四榜单标签与原规程四维选样意图可以参考，不编造分数或缺失粉丝/互动，不以标题代替视觉分析。数量不足用实际分母；零成功暂停。
- 视觉报告后调用 save_xhs_cover_plan 保存title、summary及恰好三套方案。summary说明风格总结及真实分析范围；每套稳定schemeId、name、layout、palette、完整prompt、aspectRatio固定3:4、实际observed sourceIds。不要把设计方案说成三张已生成图片。布局建议须承认样本看不清的部分，不冒充已观察内容。
- 用户明确只要方案时next=plans-only；其他情况next=choose，服务端保存后提出结构化选择。选择某方案不等于付款，生成仍需要独立批准。不用ask_question再造重复方案选择。
- generate_image 必须携带精确planReference {artifactId,version,schemeId}；服务端取该版prompt固定3:4、单张1K，不保证1080×1440精确像素。不传参考图，不承诺参考图编辑、像素级复刻或自动批量生成三张。
- 用户选中的历史xhs-cover-plan确切版本可以复用其已冻结研究证据修改方案/生成；未选该版本时不能凭手工链接冒充研究。修改使用artifactId/baseVersion的CAS。不得转到普通写作或独立图片模块绕过本合同。
- 查询、视觉分析、最终图片均单独报价；图片服务不可用时仍可保存研究方案。只开放M1/M2/M4，不提供M3/M5能力。
