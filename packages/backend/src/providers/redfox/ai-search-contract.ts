import { z } from "zod";
export const aiSearchEngines={
 kimiK3:{label:"Kimi K3",submit:"USDIOVU24",family:"kimi",price:0.18},
 kimiK25:{label:"Kimi K2.5",submit:"USDIOVU23",family:"kimi",price:0.06},
 yuanbao:{label:"元宝",submit:"O0DGBU8M",family:"yuanbao",price:0.06},
 qianwenProducts:{label:"千问（含商品卡）",submit:"API_1793002507495",family:"qianwenProducts",price:0.12},
 doubaoProducts:{label:"豆包（含商品卡）",submit:"API_1793002507670",family:"doubaoProducts",price:0.12},
 qianwen:{label:"千问",submit:"3AFD5MIX",family:"qianwen",price:0.06},
 baidu:{label:"百度",submit:"UOTABJXI",family:"baidu",price:0.06},
 doubao:{label:"豆包",submit:"I9R9LIDL",family:"doubao",price:0.06},
 deepseek:{label:"DeepSeek",submit:"KGX4SDXQ",family:"deepseek",price:0.06},
} as const;
export const aiSearchPolls={qianwenProducts:"API_1793002507566",doubaoProducts:"API_1793002507727",kimi:"IUAIUVB24",yuanbao:"PVQWHXGO",qianwen:"QLG22Y7Y",baidu:"T8BIOV6J",doubao:"3A3CIGL8",deepseek:"AJWHKFQI"} as const;
export const AiSearchEngine=z.enum(["kimiK3","kimiK25","yuanbao","qianwen","baidu","doubao","deepseek","qianwenProducts","doubaoProducts"]);
export const AiSearchFamily=z.enum(["kimi","yuanbao","qianwen","baidu","doubao","deepseek","qianwenProducts","doubaoProducts"]);
export const AiSearchTaskId=z.string().min(1).max(500).refine(v=>v.trim().length>0);
export const AiSearchInput=z.object({engine:AiSearchEngine,inquiryText:z.string().min(1).max(10000).refine(v=>v.trim().length>0)}).strict();
export const AiSearchQuery=z.object({family:AiSearchFamily,taskId:AiSearchTaskId}).strict();
export const AI_SEARCH_LIMITS={steps:62,polls:60,retries:3,pollDeadlineSeconds:7200,externalAttempts:100,pollIntervalSeconds:10,maxPollIntervalSeconds:30};
export const aiSearchPaths={
  API_1793002507495:"/story/api/deepSearch/qwaSubmit",
  API_1793002507566:"/story/api/deepSearch/qwaResult",
  API_1793002507670:"/story/api/deepSearch/dbaSubmit",
  API_1793002507727:"/story/api/deepSearch/dbaResult",
  "USDIOVU24": "/story/api/kimi/submitK3",
  "USDIOVU23": "/story/api/kimi/submit",
  "IUAIUVB24": "/story/api/kimi/result",
  "O0DGBU8M": "/story/api/deepSearch/ybSubmit",
  "PVQWHXGO": "/story/api/deepSearch/ybResult",
  "3AFD5MIX": "/story/api/deepSearch/qwSubmit",
  "QLG22Y7Y": "/story/api/deepSearch/qwResult",
  "UOTABJXI": "/story/api/deepSearch/bdSubmit",
  "T8BIOV6J": "/story/api/deepSearch/bdResult",
  "I9R9LIDL": "/story/api/deepSearch/dbSubmit",
  "3A3CIGL8": "/story/api/deepSearch/dbResult",
  "KGX4SDXQ": "/story/api/deepSearch/dsSubmit",
  "AJWHKFQI": "/story/api/deepSearch/dsResult"
} as const;
