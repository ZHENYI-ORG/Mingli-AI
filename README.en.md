**Languages:** [简体中文](README.md) · English · [日本語](README.ja.md)

# ZHENYI 真一

### The world's first AI fortune-telling language model

**Send birth details or four pillars to ZHENYI, then ask your question.** The backend calculates the chart with the included software. The model reads it through Blind School methods and also considers Wangshuai, Ziping, and Tiaohou approaches. You can try it online or download the weights and source code to run it yourself.

**27B Bazi reasoning model · Merged BF16 weights · Integrated charting · OpenAI-compatible API**

![ZHENYI model overview](docs/assets/model-overview-en.png)

[Try online](https://www.zhenyi.org) · [Model weights](https://github.com/ZHENYI-ORG/zhenyi-mingli-ai/releases/tag/v0.1.0) · [Evaluation](#evaluation) · [Quick start](#quick-start) · [API](#api-usage) · [Contribute](#why-open-source)

## Model overview

| Item | Details |
| --- | --- |
| Model scale | 27B |
| ZHENYI release | v0.1.0 |
| Format | Merged BF16 model; load one model directory at inference time |
| Training material | The team reports using over 20,000 real cases and material from several Bazi schools |
| Interface | OpenAI-compatible `/v1/chat/completions` and `/v1/models` |
| Charting | The bundled program calculates pillars and luck cycles; the backend requests missing information |
| Public artifacts | Merged weights, charting source, chat backend, web interface, and deployment scripts |

The public repository and Release do not contain the original training texts, case answers, private method prompts, or private evaluation records.

## How it works

![ZHENYI inference pipeline](docs/assets/pipeline-en.png)

If birth information is missing, the backend asks for it. Once the details are complete, the program calculates the pillars and luck cycles and the model answers using that chart. The same endpoint also handles ordinary conversation. See the [integration guide](docs/MODEL_INTEGRATION.md) for details.

## Evaluation

![Team-reported results on historical national fortune-teller competition questions: ZHENYI 73%, Claude Opus 5.5 48%, GPT-6 Astra 42%, DeepSeek V4.1 36%](docs/assets/evaluation.png)

The ZHENYI team tested the model and several general-purpose models on **questions from past national fortune-teller competitions**. The team describes the test as blind and recorded these accuracy figures.

| Model | Accuracy |
| --- | ---: |
| **ZHENYI** | **73%** |
| Claude Opus 5.5 | 48% |
| GPT-6 Astra | 42% |
| DeepSeek V4.1 | 36% |

## Model download

| Artifact | Location | Purpose |
| --- | --- | --- |
| Merged model weights | [v0.1.0 Release](https://github.com/ZHENYI-ORG/zhenyi-mingli-ai/releases/tag/v0.1.0) | Download every split asset and reconstruct the model directory |
| Reconstruction script | [scripts/reconstruct-model.py](scripts/reconstruct-model.py) | Verify SHA-256 checksums and rebuild the files |
| Source and deployment configuration | This repository | Backend, charting program, web app, and launch scripts |

The Release contains **merged weights**: ZHENYI's fine-tuning has been incorporated into the base weights, so no separate LoRA adapter is needed at deployment. Allow sufficient disk space and inference hardware for a BF16 model of this size.

## Quick start

If you only want to explore the model, use the [online experience](https://www.zhenyi.org) without deploying it.

Self-hosting requires Node.js 20+, Python 3, and a compatible [ms-swift](https://github.com/modelscope/ms-swift) inference environment. Download all Release assets, reconstruct the model, and build the backend:

```bash
gh release download v0.1.0 --repo ZHENYI-ORG/zhenyi-mingli-ai --dir model-assets
python3 scripts/reconstruct-model.py model-assets model/zhenyi
npm ci
npm run build
```

Start the model service in one terminal:

```bash
export MODEL_PATH="$PWD/model/zhenyi"
export SWIFT_BIN=/path/to/swift
bash scripts/start-model-service.sh
```

Start the ZHENYI backend and web app in a second terminal:

```bash
export ZHENYI_MODEL_BASE_URL=http://127.0.0.1:8000/v1
export ZHENYI_MODEL_NAME=ZHENYI
export PORT=8787
bash scripts/start-web.sh
```

See the [deployment guide](docs/MODEL_INTEGRATION.md) for memory requirements, access keys, and additional options.

## API usage

Clients send standard chat messages; the backend handles case detection and charting.

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"ZHENYI","messages":[{"role":"user","content":"乾造，四柱为甲子 甲戌 戊寅 庚申。请分析事业。"}]}'
```

For an OpenAI-compatible SDK, set `base_url` to `http://localhost:8787/v1` and use `ZHENYI` as the model name. Multi-turn and streaming responses are supported.

## Why open source

I believe Blind School, Wangshuai, Ziping, and Tiaohou each hold part of the truth about Bazi. Put them to work on the same case and you can see where they agree, and where their explanations conflict. Blind School sits at the center of ZHENYI, while practitioners and material from the other schools have also shaped its training.

More cases and more people pointing out wrong answers may help ZHENYI develop its own way of reading a chart. I hope it can one day reach beyond the approaches we know now. New cases will tell us how far that hope can go.

I opened the project because I want people to use it and challenge it. If the charting is wrong, an explanation feels forced, or a case goes badly, tell us where. Those specific corrections are how ZHENYI can improve.

## License and citation

- Source code: [MIT License](LICENSE).
- ZHENYI's rights in the merged model and its fine-tuning modifications: [Apache License 2.0](LICENSE-MODEL). The upstream model's copyright and license still apply; see the [model notice](NOTICE-MODEL.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Modification and redistribution are permitted under the applicable terms.
- To cite the project:

```bibtex
@misc{zhenyi2026,
  title        = {ZHENYI: An Open-Source Bazi Astrology Language Model},
  author       = {{ZHENYI-ORG}},
  year         = {2026},
  howpublished = {\url{https://github.com/ZHENYI-ORG/zhenyi-mingli-ai}}
}
```

## Star History

[![ZHENYI GitHub Star History](https://api.star-history.com/svg?repos=ZHENYI-ORG/zhenyi-mingli-ai&type=Date)](https://star-history.com/#ZHENYI-ORG/zhenyi-mingli-ai&Date)

