# Lingo Studio · 英语口语陪练

Windows 桌面英语陪练：八个经典场景、AI 自定义场景、实时云语音、原创 2D 陪练形象与本机练习历史。

`麦克风 → AudioWorklet + Silero VAD → Qwen Streaming ASR → DeepSeek → CosyVoice → PCM 流播放 + 音频驱动嘴部动画`

## 首次开发配置

环境：Windows 10/11、Node.js 24、Python 3.14、麦克风和网络连接。

```powershell
npm run setup
npm run configure
npm run dev
```

先配置服务，再启动应用。应用没有 API Key 表单或账号设置向导。

1. 在 [DeepSeek 控制台](https://platform.deepseek.com/api_keys) 创建 API Key，确认账号可调用模型。已有 Demo 的 DeepSeek Key 可在配置脚本中直接回车沿用。
2. 打开 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，使用**中国内地 / 北京地域**，确认已开通模型服务并有可用额度。
3. 获取北京地域的 API Key 和业务空间 ID，确保该 Key 有所选空间模型调用权限。新版控制台的 API Key 页面如果直接显示含 `cn-beijing.maas.aliyuncs.com` 的 Base URL，已处于北京地域；可以把整条 Base URL 填入脚本的业务空间输入，脚本会自动提取空间 ID。使用 `qwen-audio-3.1-asr-flash-streaming` 和 `cosyvoice-v3-flash`。
4. 执行 `npm run configure`。仅在本机终端的隐藏输入中填写密钥；不需要粘贴到聊天、源代码或应用界面。业务空间 ID 为普通终端输入。
5. 脚本保存本机加密配置并立即验证 DeepSeek 回复、TTS 合成和合成音频的实时 ASR。三项结果应为 `passed`。试听 `.cache/voice-preview.wav` 检查英语音色；这是合成测试音频，不含用户录音。
6. 若出现 `auth_failed`，检查 Key 的地域与空间权限；额度不足时检查百炼余额/资源包。修正后重新运行脚本即可。应用运行期间更新配置后需退出并重新启动。

配置保存在 `%APPDATA%/english-speaking-companion/services.bin`，通过 Electron safeStorage 使用当前 Windows 账号加密。开发版和安装版自动读取同一配置。`services.example.json` 是不含密钥的结构说明。安装包不包含个人配置；换电脑或 Windows 账号时，在项目中重新运行配置脚本。

0.2.1 会等待系统加密初始化并重试读取，配置不完整时明确报错并停止启动服务。可以点击“重新连接”重新读取；不会要求在应用内输入密钥。`%APPDATA%/english-speaking-companion/startup-status.json` 只记录启动阶段、错误类别和服务是否配置，不含密钥。需要诊断时可运行 `node_modules/.bin/electron scripts/inspect-local-config.cjs` 查看配置项是否可读。

## 练习功能

- 咖啡店点单、餐厅用餐、酒店入住、机场出行、购物退换、问路交通、工作面试和日常社交；每个场景有角色、开场白、三个目标和表达提示。
- A1、A2、B1、B2 难度，默认 A2。自定义场景支持一句话生成、编辑、保存、复制和删除；也可手动创建。
- Mia 开口后自动轮流收音与播放。自然停顿约 0.9 秒提交；临时识别字幕实时显示。点击“打断”停止播放与剩余合成，再恢复收音。
- 每轮最多一条轻量纠错，中文翻译和表达提示可隐藏。支持文字输入和本次会话回复重听；麦克风/云语音不可用时可继续文字练习。
- 目标根据实际表达判断，并显示原话作为依据。结束后生成中文复盘，可从历史查看对话、纠错、目标与建议，再次练习。
- 默认美式女声 `loongcally_v3`、语速 0.95；可切换英式女声 `loongemily_v3`、麦克风与减少人物动作。

## 数据与服务

0.2.5 音频播放改为连续 AudioWorklet PCM 队列，24 kHz 上下文、约 150 ms 预缓冲，保持跨网络分块的连续采样位置；不再将每个包独立创建为音源。真正缺包时短淡出并重新缓冲，打断时清空队列且立即将口型归零，丢弃旧轮次回调。仅发送给 TTS 的文本将 `&` / `&amp;` 展开为 `and`，字幕和历史原文不变。实现依据：[AudioWorklet 音频线程说明](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet)。

保留原应用标识 `com.cafelingo.demo` 和用户数据目录，支持覆盖升级。SQLite 会在旧结构迁移前生成 `cafe-lingo.pre-v2.db` 备份；旧会话保留，异常退出的会话标记为中断。会话保存场景快照，修改或删除自定义场景不会改变过去的对话。

默认只保存文字与复盘，不保存用户录音。回复音频在当前会话内存中缓存，结束后释放。麦克风片段发送到百炼识别，文本发送到 DeepSeek 对话/复盘，英文回复发送到百炼合成。后端仅监听 `127.0.0.1`，桌面端每次启动生成临时客户端凭据；API Key 不暴露给渲染页面。

陪练人物使用用户确认的 A 哑光版左侧半身原画。原图 `public/characters/a-original-matte.png` 保持不变；闭眼与张嘴仅通过 SVG 遮罩覆盖局部，其余像素沿用原画。支持自然眨眼、轻微呼吸和播放音量驱动的开/闭两态口型，静音、停止、打断时立即闭嘴。这是 2D 表情素材切换，不是 Live2D，也不是音素级口型。此前 3D 草稿保留供参考，应用不加载且安装包不包含它们。

打开 `?avatar-preview=1` 可检查自然状态、单次眨眼、本地英文试听、连续打断及完整原图。试听使用项目已有合成音频，不请求付费接口。测试命令：`node scripts/smoke-avatar2d.mjs`（需本地 18792 端口提供 dist 静态页面）；传入安装 EXE 路径可检查安装版。

## 开发与打包

```powershell
npm run dev           # Vite + Electron；自动管理本机后端
npm test              # 前端状态、流式轮次与取消检查
npm run lint          # TypeScript 检查
npm run build         # 生产界面与 Electron 编译
node scripts/smoke-desktop.mjs  # 隔离数据目录的桌面渲染检查
npm run dist:win      # Python 后端 + Windows NSIS 安装包
cd backend
..\.venv\Scripts\python.exe -m pytest -q --basetemp=.test-temp -p no:cacheprovider
```

安装包输出到 `release/Cafe-Lingo-Setup-0.2.5.exe`，安装快捷方式显示 Lingo Studio。打包暂存目录由终端报告，保留以便排查。关闭旧版后安装新版，数据和开发阶段的本机配置自动保留。安装程序尚未配置商业代码签名。

0.2.3 修复后台隐藏窗口导致再次双击无反应的问题：页面就绪时明确显示主窗口，再次启动会显示、还原并聚焦已有窗口。`node scripts/smoke-window-recovery.mjs` 使用隔离数据检查隐藏与最小化恢复；快捷方式冷启动检查同时要求窗口可见和服务就绪。

`scripts/verify-live-replies.cjs` 可用本机 DeepSeek 配置检查六条合成练习句，增加 `--scenarios` 参数可检查八个内置场景和一个生成场景。通过 `node_modules/.bin/electron scripts/verify-desktop-live.cjs` 可运行隔离数据的完整云语音桌面检查；输入是合成音频。上述检查不读取已有会话，会产生正常 API 用量。

安装后可用 `node scripts/smoke-installed.mjs "安装目录/Lingo Studio.exe" --native` 验证普通程序启动后的真实云语音流程，不通过环境注入密钥或使用 Electron 测试加载器。关闭应用后，在 PowerShell 7 中执行 `./scripts/check-shortcut-startup.ps1` 可检查三次实际桌面快捷方式冷启动。`node scripts/smoke-config-failure.mjs` 使用隔离目录检查配置读取失败时的提示及后端启动拦截。

## 项目结构

- `src/`：场景库、练习工作台、历史复盘、音频流播放器、VAD 和 2D 原画人物。
- `electron/`：窗口、安全配置读取、临时客户端凭据、Python 进程管理。
- `backend/app/`：场景 API、WebSocket 会话、SQLite 迁移、DeepSeek 与百炼语音适配。
- `backend/tests/`：场景快照、目标依据、历史迁移、取消、重试幂等与云语音协议检查。
- `scripts/`：安装依赖、开发阶段配置、真实服务验证、桌面检查与打包。

当前版本的验收结果及人工麦克风、音色试听说明见 `VALIDATION.md`。

项目架构、接口、数据与后续 TTS、3D 人物、男性人物及多人并发规划见 [DESIGN.md](DESIGN.md)。


