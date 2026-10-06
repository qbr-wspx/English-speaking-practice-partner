# A 哑光版 2D 表情小样

状态：用户已认可小样；已用于 0.2.4 的 2D 角色。此目录保留原始对比与编辑记录。

使用内置 image_gen 编辑，未调用第三方付费 API。原图与应用图片 SHA-256 均为 5424051894dde088ac3f9b6b985d275d68d16fd627c5fff7bf3b46a8b92b97c8。

只在预览中用 SVG 局部遮罩叠加眼睛或嘴巴：其他位置直接显示原图。不使用生成图整体替换原画。此目录是已确认的 2D 表情小样，不是 Live2D。正式组件已通过 PcmPlayer -> mouthLevel 接入播放与停止清零。

输入只有平面 PNG，没有 PSD 分层或 Live2D 模型；本方案不依赖用户另行提供绑定。

## 闭眼编辑提示词

Use case: precise-object-edit. Edit target: attached A matte character concept sheet. Make ONE TINY LOCAL EDIT ONLY: close both eyes of the LARGE LEFT half-body portrait naturally for a blink. Lower the same upper eyelids into relaxed thin closed eyelash curves, gently curved, with the existing eyelash color and line weight; completely hide irises and eye whites, with natural matte eyelid skin in their place. Keep eyebrows unchanged, mouth unchanged, NO smile change. Preserve the original tilt, exact face shape, nose, facial placement, hair (including bangs overlapping eyes), every clothing and accessory detail, matte colors, original background, and exact layout/scale. Right full-body design reference must stay UNCHANGED. Do NOT crop, enlarge, reframe, redesign, add labels or create multiple panels. Output same 1312x1199 full sheet aligned to input. Apart from the two small eye areas, preserve all original pixels as closely as possible. This is a blink sprite source for an already-approved 2D character, not a new illustration.

## 张嘴编辑提示词

Use case: precise-object-edit. Edit target: attached approved A matte character sheet. ONE TINY LOCAL EDIT: change ONLY the mouth of the LARGE LEFT half-body portrait from a closed subtle smile to a SMALL, NATURAL OPEN SPEAKING mouth, gentle relaxed short 'ah' shape. Mouth corners remain at their EXACT original positions, preserve the existing tilted smile line and identity, open lower lip only modestly (about 12 to 17 pixels of interior opening on the original 1312x1199 canvas), delicate muted rose inner mouth, slight pale upper-teeth edge if needed, not a large black hole or exaggerated grin. Match original fine linework and matte skin shading. Keep BOTH EYES OPEN and UNCHANGED. Nose, chin outline, cheeks, face shape, eyebrows, hair, pose, clothing, shading, background and RIGHT full-body character all remain unchanged. Preserve exact original composition, framing, canvas size 1312x1199 and pixel alignment; no crop, reframing, resize, labels, panels, beautification, gloss or redesign. Only repaint the small original mouth region. This is a mouth sprite source for an already-approved 2D character.

