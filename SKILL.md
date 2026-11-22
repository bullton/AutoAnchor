---
name: oral-video-studio
description: 把文案、章节素材、数字人参考视频和参考音色，做成 1080×1920 的竖屏口播视频。适用于需要在本机完成分镜、配音、字幕、Remotion 渲染与合成的任务，也支持由 Agent 用 Job Spec 一句话调用。
---

# 口播工坊

一套可独立运行在本机的竖屏口播视频流水线。页面负责可视化调参，Agent 负责把自然语言变成同一份 Job Spec；两条入口共用同一条流水线和同一个 `output/`。

- 成片规格：1080×1920，30fps，H.264 + AAC
- 五阶段：生成分镜 → 合成配音 → 时间轴与字幕 → 渲染画面 → 合成成片
- 可选数字人：配音后调用 Kaggle LatentSync 生成对口型片段，再进入时间轴、渲染与成片（开启后共六阶段）
- 项目内自带页面、流水线、Remotion 源码与素材；模型、Python 环境和密钥通过本机私有配置接入

## 目录

```
agent/            Agent 入口与 Job Spec schema
assets/           数字人参考、音色、配图、章节素材
config/           private.example.json（模板）；private.json（本机私有，gitignore）
input/            script.txt（文案）、series.json（系列名/副标题）
output/           当前分镜、配音、字幕、成片
pipeline/         阶段脚本、TTS 适配、Kaggle 数字人、动效与布局
remotion/         视频模板（src）与静态资源（public）
setup.html       首次配置向导
SKILL.md          本文件
```

## 安装

1. 安装依赖（只需要一次）：
   ```powershell
   npm --prefix remotion install
   ```
2. 首次配置，任选一种：
   - 运行 `npm start`，浏览器打开 `http://127.0.0.1:4310`，未配置时会自动进入首次配置页；
   - 或在终端运行 `npm run setup`，按提示填写 Python、FFmpeg、模型目录、Kaggle 数字人和 AI 接口。
3. 体检：
   ```powershell
   npm run doctor
   ```
4. 启动工作台：
   ```powershell
   npm start
   ```

私有参数只写入 `config/private.json`，不要提交、不要贴到聊天或日志里。需要分享项目时保留 `config/private.example.json` 即可。

## 页面里的五步

1. **文案**：写文案，填写系列名与副标题；在同屏选择数字人参考视频和配音音色，查看素材章节概况。
2. **配音**：选择引擎、参考音色、句间停顿；高级参数按引擎变化。
3. **画面**：上传/分章素材，调整数字人布局、风格、动效；可开启 Kaggle 生成口型数字人并选择半身/全身版本；分镜预览里可直接换图或调整单幕布局。
4. **运行台**：开始生成、看阶段实时日志（含 Kaggle 数字人）、播放或下载成片。
5. **历史**：每次运行保留配置快照、日志与成片。

## Agent 调用

Agent 不需要操作页面。读取 `agent/schema.json`，把语义参数写成 JSON，然后运行：

```powershell
node agent/run.mjs --job job.json
```

服务未启动时会自动拉起；已有服务则直接复用。输出是逐行 JSON 事件，便于 Agent 解析：

```json
{"event":"accepted","id":"20261122-153000"}
{"event":"status","status":"running","stage":2,"note":"合成配音","progress":0.42}
{"event":"done","id":"20261122-153000","finalVideo":".../output/runs/20261122-153000/final.mp4","duration":38.6}
```

常用参数：

- `--server http://127.0.0.1:4310`：指定控制台地址
- `--no-start-server`：只复用已运行的服务
- `--timeout-min 120`：超时时间

### Job Spec 示例

```json
{
  "script": "第一句文案。\n第二句文案。\n最后一句收束。",
  "seriesTitle": "终端运维自动化",
  "seriesTagline": "一组真实数据，算清半年回本",
  "provider": "voicestudio",
  "voice": "0226_prompt.wav",
  "styleId": "amber",
  "motion": "standard",
  "gapSeconds": 0.26,
  "aiBrief": "整体克制，数据段要有扫描感，结尾放慢",
  "layout": {
    "mode": "video",
    "avatar": { "src": "assets/avatar/example.mp4", "width": 0.34, "x": 0.5, "y": 0.78 }
  },
  "digitalHuman": {
    "enabled": true,
    "reference": "assets/avatar/example.mp4",
    "variant": "closeup",
    "timeoutMin": 120
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `script` / `scriptFile` | 二选一 | 完整文案；`scriptFile` 必须是项目内文件 |
| `seriesTitle` | 否 | 系列名，留空则从文案提炼 |
| `seriesTagline` | 否 | 副标题 |
| `provider` | 否 | `voicestudio` / `local3` / `cosyvoice` / `indextts` / `kaggle` / `edge` |
| `voice` | 否 | `assets/voice-ref` 下的文件名 |
| `styleId` | 否 | `amber` / `tech` / `paper` / `mono` |
| `motion` | 否 | `light` / `standard` / `strong` |
| `gapSeconds` | 否 | 句间停顿，0.12–0.6 |
| `aiBrief` | 否 | 给 AI 分镜的补充要求；填写即开启 AI 分镜 |
| `layout` | 否 | 覆盖数字人布局 |
| `digitalHuman` | 否 | 开启 Kaggle LatentSync；`enabled`、`reference`、`variant`（closeup/fullbody/auto）、`timeoutMin` |
| `resume` | 否 | 默认 `true`，复用未变化的分镜和配音 |
| `forceAll` | 否 | `true` 时从头生成 |

## 输出

- 当前分镜与预览：`output/props.json`、`output/slides.json`
- 每次任务：`output/runs/<时间戳>/`
  - `final.mp4` 成片
  - `voice.wav`、`timeline.json`、`subtitles.srt|ass`
  - `avatar.mp4`、`digital-human.json`（开启数字人时）
  - `job.json`、`run.log`、`config.json`
- 页面通过 `/media/run/<id>/final.mp4` 播放。

## 私有化配置

`config/private.json` 的完整结构见 `config/private.example.json`。关键分组：

- `paths`：Python、FFmpeg、Chrome、模型根目录、依赖根目录、VoiceStudio、IndexTTS、Kaggle Python/CLI、参考音色目录
- `tts`：按 provider 覆盖配音参数；路径可写绝对路径，也可写项目相对路径
- `kaggle`：用户名、API Key / Token、数据集、Notebook、加速器与等待上限；也可使用本机 `~/.kaggle/kaggle.json`
- `ai`：OpenAI 兼容接口地址、模型、Key；也可只写 `keyEnv` 从环境变量取

首次配置页只收集这些参数，不会改动代码。把项目复制给他人时，删除 `config/private.json`，对方打开页面会自动进入向导。

## WorkBuddy 模型

- WorkBuddy 官方文档没有提供“项目内服务直接读取当前会话模型凭证”的接口，因此**不能**从流水线里直接调用 Agent 当前会话模型。
- 在 WorkBuddy 里由 Agent 执行本 Skill 时，语义理解天然使用当前会话模型；Agent 负责生成 Job Spec 和调用命令。
- 页面里的 AI 分镜需要独立配置。首次配置页支持从本机 WorkBuddy 自定义模型配置导入（本地 `models.json`，常见位置 `%USERPROFILE%\.workbuddy\models.json`）；导入后密钥只写入私有配置，不回显到页面。
- 也可以手动填写任意 OpenAI 兼容接口（DeepSeek、通义、Ollama 等）。

## 故障排查

- **页面打不开**：确认 `npm start` 正在运行，默认 `http://127.0.0.1:4310`。
- **Python 未找到**：运行 `npm run setup`，把 Python 指向已安装 TTS 依赖的虚拟环境。
- **VoiceStudio 未启动**：在配音页点“现在启动”，或确认 `paths.voiceStudioRoot/server.env.json` 配置正确。
- **渲染失败**：运行 `npm --prefix remotion install`；首次渲染可能需要下载 Chromium。
- **AI 分镜回退规则版**：检查 `config/private.json` 的 `ai.enabled`、Key 或 `keyEnv`；失败不会阻塞出片。
- **模型缺失**：`npm run doctor` 会列出模型、依赖、Kaggle 凭据和音色目录状态。大模型不随项目分发。
- **数字人失败**：确认参考素材是视频、Kaggle 已登录且有 GPU 配额；日志会回传 Kaggle 任务页与末段错误。首次运行约 40–55 分钟，之后复用数据集缓存。

## 安全

- 不把 `config/private.json`、`.env`、参考音频、成片提交到仓库。
- 页面和 Agent 日志不应打印密钥；服务端返回 AI 配置时会自动隐藏 Key。
- 分享项目时只保留 `config/private.example.json` 和示例素材。
