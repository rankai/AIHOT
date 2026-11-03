# Platform Image Specs

This is the reusable image-size inventory for `ai-image-generator`.

Core priority:

1. If the user explicitly specifies a size or aspect ratio, use the user's value.
2. If the user does not specify size and the prompt matches a known use case, use this table.
3. If there is no match, do not invent a size. Let the provider/script default apply.

The generation prompt must remain the user's original prompt in Direct mode.
These specs only fill API parameters such as `--size` and `--aspect-ratio`.

| Asset type | Keywords | Aspect ratio | Target size | Notes |
|---|---|---:|---:|---|
| `wechat_main_cover` | 微信公众号头图, 公众号头图, 微信头图, 公众号封面 | `2.35:1` | `1800x766` or `900x383` | Use `21:9` when a provider cannot render exact `2.35:1`. |
| `wechat_square_cover` | 微信公众号方图, 公众号方图, 微信分享图 | `1:1` | `1080x1080` or `900x900` | Share card or secondary cover. |
| `wechat_body_illustration_wide` | 公众号文章配图, 微信公众号正文配图, 文章配图 | `16:9` | `1920x1080` or `1280x720` | Article body illustration. |
| `wechat_body_illustration_4_3` | 公众号解释图, 微信公众号说明图, 文章说明图 | `4:3` | `1440x1080` | Explanation visuals and diagrams. |
| `xhs_cover_card` | 小红书封面, 小红书头图, 小红书首图 | `3:4` | `1080x1440` | First card cover. |
| `xhs_content_card` | 小红书配图, 小红书内容卡, 小红书图文 | `3:4` | `1080x1440` | Xiaohongshu image post/card. |
| `douyin_video_cover` | 抖音封面, 抖音视频封面, 竖屏视频封面 | `9:16` | `1080x1920` | Vertical short-video cover. |
| `ppt_cover` | PPT 封面, 演示文稿封面, presentation cover | `16:9` | `1920x1080` or `1280x720` | Widescreen presentation cover. |
| `mobile_wallpaper` | 手机壁纸, 手机锁屏, 竖屏壁纸 | `9:16` | `1080x1920` | Mobile wallpaper. |
| `bilibili_cover` | B站封面, 哔哩哔哩封面, 视频封面 | `16:9` | `1920x1080` or `1280x720` | Horizontal video thumbnail. |
| `blog_social_cover` | 博客封面, 文章封面, 社交封面 | `16:9` | `1920x1080` or `1280x720` | Blog, newsletter, and social cover. |
| `social_vertical_card` | 竖版海报, 竖版配图 | `4:5` | `1080x1350` | General vertical social feed image. |
| `ecommerce_main_image` | 电商主图, 商品主图, 产品主图 | `1:1` | `1200x1200` or `1080x1080` | Product listing main image. |
| `avatar` | 头像, 社交头像, 卡通头像 | `1:1` | `1024x1024` | Profile avatar. |

The machine-readable source is `platform-image-specs.json`.
