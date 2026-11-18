# 检查违禁词
读取word-check-adaptation和prohibited-word-workflow，执行本次明确的一份文案。input与taskScope.wordCheck由服务端冻结；不得扩大到其他材料、网页、图片或历史稿件。使用check_xhs_words从batch=0按序检测所有冻结批次；未知/失败先核对，不换参数重试。只处理真实返回的hitId，保存前确认所有批次已完成。
使用save_xhs_word_check交付。只替换命中词的必要文字，不全文改写、不添加emoji、保留排版语气。suggestions每项hitId/replacement/reason，不能计算偏移。疑似英文子串命中保留原文，不自动修改；零命中用空suggestions。合并同位置命中ID，不重复替换重叠位置。完整报告保存后结束，不自动再次检测或替换用户旧稿件。
