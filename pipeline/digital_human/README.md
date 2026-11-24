# LatentSync on Kaggle T4 x2

在 Kaggle 免费 GPU 上跑 [LatentSync](https://github.com/bytedance/LatentSync) 做数字人唇形同步：一条视频 + 一段音频 → 全身、半身两个版本。

项目本身不绑定任何账号或素材：账号由你机器上的 Kaggle 凭据自动识别，视频和音频用命令行传入，不用改 Notebook 代码。

> 本目录已内置到口播工坊。页面或 `/api/run` 会在“合成配音”后调用 `pipeline/digital_human.mjs`，把生成的对口型片段写回本次任务的 `avatar.mp4` 与 `digital-human.json`，再进入时间轴、渲染和成片。账号参数在首次配置页或 `config/private.json` 的 `kaggle` 分组里填写。

## 快速开始

1. 准备 Kaggle 凭据（三选一）：

```bash
kaggle auth login                    # 浏览器登录，令牌存在 ~/.kaggle/access_token
# 或把 API token 放到 ~/.kaggle/kaggle.json
# 或设置环境变量 KAGGLE_USERNAME / KAGGLE_KEY
```

确认可用：`kaggle datasets list --page-size 1`。

2. 安装驱动脚本需要的 Kaggle CLI（本机没有时）：

```bash
pip install kaggle
# 或：uv tool install kaggle --with six
```

3. 把视频和音频放进 `inputs/`，然后：

```bash
python run.py
```

或者直接指定文件：

```bash
python run.py --video inputs/me.mp4 --audio inputs/voice.wav
```

脚本会自动：识别账号（例如 `<你的账号>`）→ 建/更新私有数据集 `<账号>/latentsync-inputs` → 生成并推送 Notebook → 轮询状态 → 下载成片到 `results/<时间戳>/`。

```
results/20261122-153000/
├── fullbody/video_out.mp4    # 全身，长边 1440（保持比例）
├── closeup/video_out.mp4     # 半身，按原片比例裁头肩后缩到高 1280
├── fullbody/result.json
├── closeup/result.json
└── summary.json
```

## 常用参数

| 参数 | 作用 |
| --- | --- |
| `--video` / `--audio` | 本地素材路径；省略则取 `inputs/` 里最新的 |
| `--only fullbody` / `--only closeup` | 只跑一个版本 |
| `--crop-pct 37:37:23:23` | 半身裁切：宽:高:左:上（相对原片的百分比） |
| `--crop-px 800:1422:500:887` | 半身裁切：改用绝对像素 |
| `--crop-out 720x1280` | 半身输出分辨率（默认 auto，高 1280 保持比例） |
| `--dataset` | 复用已有数据集，写 slug 或 `owner/slug` |
| `--kernel` | Notebook 名称，默认 `latentsync-dual` |
| `--accel` | 加速器，默认 `NvidiaTeslaT4`（即 GPU T4 x2） |
| `--no-run` | 只保存 Notebook 版本，不实际跑 |
| `--no-wait` | 推送后立即返回 |
| `--timeout` | 等待分钟数，默认 120 |
| `--queue-timeout-min` | 排队超过多少分钟就取消并重新排队，默认 3；0 表示一直等 |
| `--queue-retries` | 排队超时后最多重新排队几次，默认 3 |
| `--queue-retry-delay` | 取消后等待多少秒再重新推送，默认 20 |
| `--force-upload` | 素材没变也重新上传数据集 |

素材内容没变时不会重复上传数据集，直接复用，省掉每次上百 MB 的上传时间。

## 换成别人的账号 / 换台机器

不需要改任何文件：换 token 即可。脚本每次都会从当前凭据里读账号，数据集和 Notebook 都建在这个账号下（`<账号>/latentsync-inputs`、`<账号>/latentsync-dual`）。

## Notebook 自己怎么找素材

- 数据集里的 `inputs.json` 会写明用哪个视频、哪个音频（由 `run.py` 生成）。
- 没有 `inputs.json` 时（例如直接在 Kaggle 网页里挂数据集跑），自动在 `/kaggle/input` 下按扩展名找：视频 `.mp4/.mov/.mkv/...`，音频 `.wav/.mp3/.m4a/...`。
- 多个候选时取第一个，并打印候选列表。

## 在 Kaggle 网页里跑

1. 新建 Notebook，上传 `latentsync_kaggle_t4x2.ipynb`；
2. Settings → Accelerator 选 `GPU T4 x2`，Internet 选 `On`；
3. Add Data 挂上含视频和音频的数据集；
4. Run All。首次约 40–55 分钟（装依赖 + 下 5GB 权重 + 两次推理）。

## 实测数据

单条 2160×3840、50.88s 的竖屏全身素材，同一段约 31s 的音频：

| 版本 | 输出 | 推理耗时 | 显存峰值 |
| --- | --- | --- | --- |
| 全身 | 810×1440，31.36s | 610s | 7653 MB |
| 半身 | 722×1280，31.36s | 606s | 7653 MB |

整轮（建环境 + 权重 + 两次推理）约 26 分钟。两张 T4 里只用第一张，第二张空闲。

## 关键取舍与踩坑

- **模型版本**：只能用 1.5 @ 256。1.6 @ 512 约需 18GB，单张 T4（约 15GB 可用）放不下；两卡无 NVLink，官方 pipeline 也不支持跨卡拆 UNet。
- **4K 必须先缩小**：`LipsyncPipeline` 整段一次性解码成张量，2160×3840 × 1272 帧约 120GB 内存。全身版先缩到长边 1440（约 4.4GB），半身版直接裁切后缩放。
- **人脸尺寸**：`FaceDetector` 要求人脸至少 50×80 px，否则判为未检出。全身镜头缩到长边 720 时人脸只有约 45px，会全片漏检；长边 1440 后约 121px。检测输入也从 512 提到 1024。
- **输出时长按音频切块**：LatentSync 按 Whisper 音频特征切块，成片时长约等于音频长度，尾部多余视频帧会被丢弃，属正常行为。
- **Python 版本**：Kaggle 镜像是 Python 3.13，官方依赖钉 3.10（mediapipe、opencv、numpy 1.26 都没有 3.13 wheel）。Notebook 用 `uv` 建独立 3.10 环境。
- **fp16**：官方 `inference.py` 在 compute capability ≤ 7 时强制 fp32，T4（7.5）会被降级，Notebook 改成 `>= 7`。
- **排队**：推送时显式带 `--accelerator NvidiaTeslaT4`，否则可能落到默认池长时间排队。排队超过 `--queue-timeout-min`（默认 3 分钟）会自动取消当前版本并重新排队，最多 `--queue-retries` 次（默认 3）。报 `Maximum batch GPU session count of 2 reached` 说明有旧会话占位，删掉旧 kernel 版本再推。
- **不是服务器**：单次会话上限约 12 小时，每周约 30 小时，政策禁止 server farming。Notebook 最后一格支持 `ENABLE_GRADIO_TUNNEL=1` 起 Gradio + cloudflared 临时隧道。
- **画质**：人脸占画面比例越小，嘴部越软；头肩/半身近景效果更好。

## 目录

```
run.py                          # 一键驱动：账号识别 → 上传 → 推送 → 下载
latentsync_kaggle_t4x2.ipynb    # 通用 Notebook：自检 → 环境 → 权重 → 预处理 → 人脸预检 → 推理 → 汇总
inputs/                         # 放本地素材（不入库）
build/                          # 运行时生成的上传/推送暂存（不入库）
results/                        # 成片与日志
samples/                        # 测试素材
assets/                         # 预览图与近景素材
SKILL.md                        # 给 agent 看的调用说明
```
