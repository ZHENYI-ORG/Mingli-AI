# 真一 ZHENYI：排盘与模型聊天服务

本仓库包含真一的 TypeScript 排盘源码、自动识别命例的聊天后端、网页、部署脚本和运行提示词。客户端向 `/v1/chat/completions` 发送普通聊天消息；后端在命例资料完整时调用排盘程序，再交给模型分析。资料不足时会在对话中提醒补充。

## 部署

需要 Node.js 20+、Qwen3.8-27B 底模与真一 LoRA 适配器。模型权重暂未在本仓库公开；部署者需自行准备模型文件。具体启动命令和 API 示例见 [部署文档](docs/MODEL_INTEGRATION.md)。

```bash
npm ci
npm run build
npm test
```

训练原文、命例答案和私人回测记录不属于公开部署包。此版本的命例准确率尚未通过完整验收，请勿将文字推演视为已验证的事实。

源码许可证见 [LICENSE](LICENSE)，第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。底模许可证请查看 Qwen 官方模型页。
