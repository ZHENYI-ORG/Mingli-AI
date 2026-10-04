# 真一模型与排盘一体部署

此版本在原排盘源码上提供标准聊天接口 `POST /v1/chat/completions`。客户端像调用普通大模型一样发送 `model` 和 `messages`。后端从本次对话中识别命例，调用原有 `computePaipan`，把排盘摘要作为模型上下文，再返回标准模型响应。客户端不需要单独调用排盘接口。模型密钥只保存在后端环境变量中。

## 标准模型调用

```bash
curl http://服务器地址:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"ZHENYI","messages":[{"role":"user","content":"乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。"}]}'
```

客户端的 OpenAI 兼容 `base_url` 设置为 `http://服务器地址:8787/v1`，模型名填 `ZHENYI`。接口也支持 `stream:true` 的流式响应及 `GET /v1/models`。继续追问时，按标准多轮对话方式把先前的用户消息一起发来；后端会从历史消息中重新提取命例并排盘。没有命例的普通提问仍按聊天请求转发。

消息可以给年、月、日、时四柱，例如 `四柱为甲子 甲戌 戊寅 庚申`；也可以给完整公历出生日期、钟表时间、性别和经度，例如 `公历1982年9月27日15:00，女，东经116.4`。提供经度时排盘程序计算真太阳时；没提供经度时按钟表时间排盘。性别缺失时不推断大运方向与具体应期。仅给出生日期而没有出生时间时，请先补充资料。

当对话中没有可排盘的完整资料时，后端先让模型判断用户是否在请求分析具体命例。若是，就以标准 assistant 消息提醒补充四柱或出生资料；若是在聊概念或其他话题，则正常转给模型回答。用户下一条补充资料时，客户端照常发送完整 `messages` 历史，后端会合并用户提供的信息再排盘。意图判断只决定是否提醒补资料，排盘始终由程序执行。

## 其他入口

- `/analyze.html`：粘贴四柱命例并提问，例如 `乾造 四柱为甲子 甲戌 戊寅 庚申。请分析事业。`。发送后自动排盘并调用模型。
- 原排盘结果页的「AI 解读」中，点击「分析当前命盘」：后端使用出生资料或四柱重新排盘，再调用模型。
- 已有结构化出生资料时，也可向 `/api/ai/analyze` 发 `{"question":"...","paipan_input":{...}}`；`paipan_input` 格式与 `/api/paipan` 相同。

仅有出生日期但缺时辰、地点等必要信息时，应先到专业排盘页补全。四柱直排未给出生年份或起运信息时，接口不会编造具体流年。

## 部署

需要 Node.js 20+、Qwen3.8-27B 原始权重、真一 LoRA 适配器，以及支持当前模型的 ms-swift 环境。底模与适配器正在上传至本仓库的 v0.1.0 Release，完成核验后公开。发布后按仓库首页的命令下载、还原并校验。模型服务需要足够的显存；低显存机器需自行配置量化或其他推理方案。

```bash
npm ci
npm run build
npm run test:ai

export BASE_MODEL_PATH="$PWD/model/base"
export ADAPTER_PATH="$PWD/model/adapter"
export SWIFT_BIN=/path/to/swift
bash scripts/start-model-service.sh
```

在另一个终端启动排盘与分析网页：

```bash
export ZHENYI_MODEL_BASE_URL=http://127.0.0.1:8000/v1
export ZHENYI_MODEL_NAME=ZHENYI
export PORT=8787
bash scripts/start-web.sh
```

聊天客户端连接 `http://服务器地址:8787/v1`。若底层模型服务设置了密钥，在网页服务环境中另设 `ZHENYI_MODEL_API_KEY`。如需为公开聊天接口设置访问密钥，配置 `ZHENYI_PUBLIC_API_KEY`，客户端用标准 `Authorization: Bearer <密钥>` 请求。

适配器目录需直接包含 `adapter_model.safetensors` 和 `adapter_config.json`。运行脚本默认使用 bf16；请按实际显存选择设备和推理配置。

## 边界

四柱和岁运由排盘程序计算，模型生成文字分析。接口只向模型发送精简后的命盘数据，不发送完整排盘响应。聊天接口不查找训练答案。已训练命例的实际准确率需用训练后回测确认。
