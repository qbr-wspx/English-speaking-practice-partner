# 英语口语陪练：原创角色概念方案

生成日期：2026-10-01。使用内置 image_gen 图像生成工具。

三张图片均已目视检查，包含面部近景和全身造型。这些是二维概念图，不是可旋转、带骨骼、表情或口型的 3D / VRM 文件。图片中的细发丝、针织纹理和柔和阴影是概念表现，后续建模时需要另行实现或简化。两视图不是严格的正交建模图，也不能保证完全一致的几何细节。

- A-crystalline-idol.png：清透偶像，银白长发、蓝紫眼睛、白蓝学院服。
- B-gentle-companion.png：软萌学姐，银紫短发、浅蓝开衫、圆领衬衫。
- C-lively-companion.png：元气搭档，银蓝高马尾、蓝色眼睛、轻运动外套。

## 完整提示词的组成

每次调用使用下面的共同提示词，再拼接对应款式提示词。无输入参考图，transparent_background=false。内置工具未开放此次输出的模型、质量或尺寸选择，下面不作推断。

### 共同提示词（原文）

Create an exceptionally beautiful original adult anime female character for an English speaking practice companion, age 20, tasteful and friendly. This is a visual character concept, rendered as a premium Japanese anime VTuber 3D avatar using exquisite cel-shaded / toon-shaded 3D rendering. Strongly anime face: big beautifully structured eyes, delicate small nose, small natural smile, softly rounded cheeks, harmonious facial proportions. Elegant soft sculpted hair clumps, subtle ambient occlusion but mostly clean cel shading; skin NOT realistic. Aim for polished virtual idol aesthetics and approachable cute charm. Original design, do not recreate any existing named character. No uncanny photoreal human face, no western animated movie proportions, no cheap plastic doll, no generic AI influencer, no chibi, no baby or child proportions, no sexualization, no animal ears. Production-friendly shapes that can plausibly be modeled as a VRM character: coherent garment layers, restrained accessories, no floating clothing, no impossible hair details. Pale cool off-white studio background, clean restrained layout, generous whitespace. A premium character design board: one large waist-up front-facing portrait on the left, one smaller complete full-body front view on the right (head to shoes fully visible, relaxed symmetrical stance, arms slightly apart); exactly the same character and outfit in both views. Face takes enough space for judging the beauty. Consistent lighting and identity. No lettering, logos, watermarks, UI, or props.

### A 款追加提示词（原文）

DESIGN A / crystalline idol: long silky silver-white hair with a whisper of icy blue at the tips, waist length, two balanced long hair sections over shoulders and a small half-up clasp in back, naturally layered bangs framing the face, a single tiny translucent blue diamond hair clip; luminous blue-violet irises with fine anime highlights. Clear and elegant yet approachable warm smile. White and ice-blue collegiate cropped blazer over a modest white blouse, small pale-blue neck ribbon, navy pleated skirt, opaque pale stockings and neat white blue-trimmed shoes. Understated silver accents, no mechanical clutter. Beautiful silhouette, delicate tidy detailing, timeless idol elegance. Hair looks airy and glossy with sculpted anime contours.

### B 款追加提示词（原文）

DESIGN B / gentle cute university companion: soft silver-lavender hair, a shoulder-length slightly curled bob with small rounded half-up side bunches (not enormous twin tails), airy curved bangs, a little blue satin barrette. Large periwinkle eyes, rounder soft face, gentle cheerful smile and a tiny hint of cheek blush. White blouse with a rounded collar, powder-blue knitted cardigan, a small lavender ribbon at collar, modest blue pleated skirt, opaque white socks and simple blue-and-white loafers. White, powder blue, silver lavender palette. Charming comfortably dressed university student, plush soft shapes but clearly a young adult. No maid outfit, no costume fetish, no excessive ribbons. Most approachable and soft-cute of the three.

### C 款追加提示词（原文）

DESIGN C / lively contemporary companion: silver-white hair with subtle pale-blue tint, long hair in a neat high ponytail with a blue ribbon, light asymmetrical side-swept bangs, one simple blue geometric hair pin. Sparkling clear aqua-blue eyes and a bright slightly open-mouth friendly smile, charming energetic young adult. A clean white and icy-blue varsity-inspired lightweight jacket over modest navy top, a simple navy pleated skirt with one pale blue edge stripe, opaque pale tights, practical white blue-trimmed sneakers. A tiny minimalist collar clip suggesting a communication assistant, no headset covering the face. White, ice blue and navy palette, very restrained modern future accents, no armor or cyberpunk. Dynamic personality through facial expression while maintaining relaxed front-facing modeling-friendly pose.

## 下一阶段需要确定的内容

选定审美后，以所选图片为外观参考，补充统一的正面、侧面、背面造型以及表情设计。真正的 3D 成品需要可用的几何模型、纹理、骨骼、表情和口型，以及项目内的动画驱动与渲染检查；当前概念图不代表这些工作已完成。
