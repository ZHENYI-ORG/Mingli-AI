# 真一 ZHENYI：排盘与模型聊天服务

本仓库包含真一的 TypeScript 排盘源码、自动识别命例的聊天后端、网页、部署脚本和运行提示词。客户端向 `/v1/chat/completions` 发送普通聊天消息；后端在命例资料完整时调用排盘程序，再交给模型分析。资料不足时会在对话中提醒补充。

## 部署

需要 Node.js 20+、Qwen3.8-27B 底模与本项目发布的 LoRA 适配器。模型文件在本仓库的 [v0.1.0 Release](https://github.com/ZHENYI-ORG/Zhenyi-AI/releases/tag/v0.1.0) 附件中发布。由于单个附件有大小限制，底模分为多个文件；下载全部附件后，使用 `scripts/reconstruct-base.py` 按 SHA-256 校验并还原。源码仓库不含模型权重。具体启动命令和 API 示例见 [部署文档](docs/MODEL_INTEGRATION.md)。

```bash
gh release download v0.1.0 --repo ZHENYI-ORG/Zhenyi-AI --dir model-assets
python3 scripts/reconstruct-base.py model-assets model/base
mkdir -p model/adapter
unzip model-assets/zhenyi-qwen3.8-27b-adapter-only.zip -d model/adapter
```

```bash
npm ci
npm run build
npm test
```

训练原文、命例答案和私人回测记录不属于公开部署包。此版本的命例准确率尚未通过完整验收，请勿将文字推演视为已验证的事实。

源码许可证见 [LICENSE](LICENSE)，第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。底模许可证请查看 Qwen 官方模型页。
