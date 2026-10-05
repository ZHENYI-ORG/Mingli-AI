**语言 / Languages:** 简体中文 · [English](README.en.md) · [日本語](README.ja.md)

# Mingli AI

### 真一 ZHENYI｜全球首个开源 AI 算命命理大模型

我们把盲派做功技法训练进模型，同时吸收旺衰、子平、调候的判断方法。用户发来出生资料，程序自动排盘；真一结合命局与岁运，围绕具体问题展开推演。

模型权重、排盘程序、聊天后端和部署代码现已开放。你可以[在线体验](https://www.zhenyi.org)，也可以下载完整项目，在自己的服务器上部署和继续开发。

![真一模型概览](docs/assets/model-overview.png)

[在线体验](https://www.zhenyi.org) · [模型权重](https://github.com/ZHENYI-ORG/Mingli-AI/releases/tag/v0.1.0) · [评测结果](#评测结果) · [快速部署](#快速部署) · [API 调用](#api-调用) · [参与项目](#为什么开源)

## 目录

- [模型概览](#模型概览)
- [工作流程](#工作流程)
- [评测结果](#评测结果)
- [模型下载](#模型下载)
- [快速部署](#快速部署)
- [API 调用](#api-调用)
- [为什么开源](#为什么开源)
- [许可与引用](#许可与引用)
- [Star History](#star-history)

## 模型概览

| 项目 | 说明 |
| --- | --- |
| 模型规模 | 27B |
| 真一版本 | v0.1.0 |
| 模型格式 | 已合并微调权重的 BF16 模型；部署时加载单个模型目录 |
| 训练资料 | 团队提供两万多个真实命例，以及多个流派的理论与经验 |
| 推理入口 | OpenAI 兼容的 `/v1/chat/completions` 和 `/v1/models` |
| 排盘能力 | 配套程序完成四柱、岁运等计算；资料不足时提示补充 |
| 开源内容 | 合并版模型权重、排盘源码、聊天后端、网页和部署脚本 |

训练原文、命例答案、私有理法提示词和私人回测记录不在公开仓库或 Release 中。

## 工作流程

![真一推理流程](docs/assets/pipeline.png)

出生信息不全时，后端会先请用户补充。资料齐全后，程序计算四柱和岁运，模型根据排盘结果作答。日常聊天也走同一个接口。实现细节见 [部署文档](docs/MODEL_INTEGRATION.md)。

## 评测结果

![全国算命师历年大赛题目评测：真一 73%，Claude Opus 5.5 48%，GPT-6 Astra 42%，DeepSeek V4.1 36%](docs/assets/evaluation.png)

真一团队拿**全国算命师历年大赛题目**测试了真一和几款通用模型，并将这轮测试称为盲测。记录的正确率如下。

| 模型 | 准确率 |
| --- | ---: |
| **真一 ZHENYI** | **73%** |
| Claude Opus 5.5 | 48% |
| GPT-6 Astra | 42% |
| DeepSeek V4.1 | 36% |

## 模型下载

| 文件 | 位置 | 用途 |
| --- | --- | --- |
| 合并版模型权重 | [v0.1.0 Release](https://github.com/ZHENYI-ORG/Mingli-AI/releases/tag/v0.1.0) | 下载全部分卷附件后还原完整模型目录 |
| 还原脚本 | [scripts/reconstruct-model.py](scripts/reconstruct-model.py) | 校验 SHA-256 并重建模型文件 |
| 源码与部署配置 | 本仓库 | 后端、排盘程序、网页和启动脚本 |

Release 提供的是**合并版权重**。真一的微调结果已经写入模型，部署时不用另行加载 LoRA。文件较大，需要足够的磁盘空间和支持 BF16 的推理硬件。

## 快速部署

如果只想体验模型，无需自行部署，可直接访问 [真一在线体验](https://www.zhenyi.org)。

需要 Node.js 20+、Python 3，以及支持该模型的 [ms-swift](https://github.com/modelscope/ms-swift) 推理环境。先下载全部 Release 附件，按校验值还原模型，再构建后端：

```bash
gh release download v0.1.0 --repo ZHENYI-ORG/Mingli-AI --dir model-assets
python3 scripts/reconstruct-model.py model-assets model/zhenyi
npm ci
npm run build
```

在第一个终端启动模型服务：

```bash
export MODEL_PATH="$PWD/model/zhenyi"
export SWIFT_BIN=/path/to/swift
bash scripts/start-model-service.sh
```

在第二个终端启动真一后端与网页：

```bash
export ZHENYI_MODEL_BASE_URL=http://127.0.0.1:8000/v1
export ZHENYI_MODEL_NAME=ZHENYI
export PORT=8787
bash scripts/start-web.sh
```

显存需求、访问密钥和更多配置见 [部署文档](docs/MODEL_INTEGRATION.md)。

## API 调用

客户端只需调用标准聊天接口；后端会自动处理命例识别和排盘。

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"ZHENYI","messages":[{"role":"user","content":"乾造，四柱为甲子 甲戌 戊寅 庚申。请分析事业。"}]}'
```

兼容 OpenAI SDK 的客户端可将 `base_url` 设为 `http://localhost:8787/v1`，模型名设为 `ZHENYI`。接口支持多轮对话与流式响应。

## 为什么开源

我一直觉得，盲派、旺衰派、子平派和调候派都掌握着命理真相的一部分。把它们放到同一个命例上，哪里判断一致，哪里说法冲突，就应该讲清楚。真一以盲派为核心，训练时也用了其他流派师傅的经验和相关理论。

命例多了，判错的地方有人指出来，真一才有机会形成自己的解读逻辑。我期待它将来能走出人类已有的解读范围，甚至达到我们现在想不到的高度。这个想法要靠新的命例一次次检验。

我选择开源，就是想请更多人一起用、一起挑错。排盘有没有算错，分析哪里牵强，哪些命例答得不好，都欢迎直接指出来。真一要继续往前走，少不了这些具体的反馈。

## 许可与引用

- 本仓库源码采用 [MIT License](LICENSE)。
- 真一合并版模型权重及真一训练形成的增量采用 [Apache License 2.0](LICENSE-MODEL)；底模版权与原有许可仍须遵守，见 [模型许可说明](NOTICE-MODEL.md)及 [第三方声明](THIRD_PARTY_NOTICES.md)。允许按许可修改和再发布。
- 如在研究或项目中使用真一，可引用本仓库：

```bibtex
@misc{mingliai2026,
  title        = {Mingli AI: The ZHENYI Open-Source Bazi Astrology Language Model},
  author       = {{ZHENYI-ORG}},
  year         = {2026},
  howpublished = {\url{https://github.com/ZHENYI-ORG/Mingli-AI}}
}
```

## Star History

[![真一 GitHub Star 增长曲线](https://api.star-history.com/svg?repos=ZHENYI-ORG/Mingli-AI&type=Date)](https://star-history.com/#ZHENYI-ORG/Mingli-AI&Date)

