**言語 / Languages:** [简体中文](README.md) · [English](README.en.md) · 日本語

# 真一 ZHENYI

### 世界初の AI 八字占術・命理言語モデル

**27B 八字分析モデル · 統合済み BF16 ウェイト · 排盤プログラム同梱 · OpenAI 互換 API**

![真一モデルの概要](docs/assets/model-overview-en.png)

[オンラインで試す](https://www.zhenyi.org) · [モデルをダウンロード](https://github.com/ZHENYI-ORG/zhenyi-mingli-ai/releases/tag/v0.1.0) · [評価結果](#評価結果) · [導入手順](#導入手順) · [API](#api-の使用) · [参加する](#オープンソースにした理由)

**自分で導入しない場合は、[www.zhenyi.org](https://www.zhenyi.org) で真一を試せます。**

## プロジェクトについて

真一は、八字（四柱推命）の分析を目的とするオープンソースの言語モデルプロジェクトです。盲派の理論と技法を中心に、旺衰派、子平派、調候派の知見も取り入れています。同じ命式を複数の流派から検討し、判断の根拠を示す解釈を目指します。

ユーザーは生年月日時などの出生情報、または四柱を送って、そのまま質問できます。バックエンドが命例を検出して情報を確認し、同梱の排盤プログラムで四柱と運勢の周期を計算してから、結果をモデルに渡します。**計算はプログラムが行い、モデルは解釈を担当します。**

## モデル概要

| 項目 | 内容 |
| --- | --- |
| ベースモデル | Qwen3.8-27B |
| 真一のバージョン | v0.1.0 |
| 形式 | 微調整結果を統合した BF16 モデル。推論時は一つのモデルディレクトリを読み込みます |
| 学習資料 | プロジェクトチームによると、2 万件以上の実例と複数流派の資料を使用しました |
| インターフェース | OpenAI 互換の `/v1/chat/completions` と `/v1/models` |
| 排盤 | 同梱プログラムが四柱や運勢の周期を計算し、情報不足なら追加入力を求めます |
| 公開物 | 統合済みウェイト、排盤ソース、チャットバックエンド、Web 画面、導入スクリプト |

学習用原文、命例の正解、非公開の理法プロンプト、非公開の評価記録は、このリポジトリと Release に含まれません。

## 処理の流れ

![真一の推論フロー](docs/assets/pipeline-en.png)

バックエンドは会話から命例を検出します。出生情報が足りない場合は補足を求めます。情報がそろえば、排盤プログラムが計算し、モデルが文章で分析します。同じ API で通常の会話にも対応します。詳しくは [統合・導入ガイド](docs/MODEL_INTEGRATION.md)をご覧ください。

## 評価結果

![過去の全国占い師大会の問題を使ったチーム報告値：真一 73%、Claude Opus 5.5 48%、GPT-6 Astra 42%、DeepSeek V4.1 36%](docs/assets/evaluation.png)

プロジェクトチームは**過去の全国占い師大会の問題**で真一と汎用モデルを比較し、今回の評価を「ブラインドテスト」と説明しています。チームから報告された正答率は次のとおりです。

| モデル | 正答率 |
| --- | ---: |
| **真一 ZHENYI** | **73%** |
| Claude Opus 5.5 | 48% |
| GPT-6 Astra | 42% |
| DeepSeek V4.1 | 36% |

> **評価について：**数値と「ブラインドテスト」という説明はプロジェクトチームから提供されたものです。問題ごとの入力、モデルの回答、採点記録、学習データとの重複状況、各モデルの設定は未公開で、現時点では独立した再検証はできません。DeepSeek V4.1 の詳しいバージョンも確認中です。

## モデルのダウンロード

| ファイル | 場所 | 用途 |
| --- | --- | --- |
| 統合済みモデルウェイト | [v0.1.0 Release](https://github.com/ZHENYI-ORG/zhenyi-mingli-ai/releases/tag/v0.1.0) | すべての分割ファイルを取得し、モデルを復元します |
| 復元スクリプト | [scripts/reconstruct-model.py](scripts/reconstruct-model.py) | SHA-256 を検証してファイルを再構成します |
| ソースと導入設定 | このリポジトリ | バックエンド、排盤、Web 画面、起動スクリプト |

Release のウェイトには真一の微調整結果が**統合済み**です。導入時に LoRA アダプターを別途読み込む必要はありません。モデルのサイズに見合うストレージと BF16 推論環境をご用意ください。

## 導入手順

まず試したいだけなら、導入せずに [オンライン版](https://www.zhenyi.org)をご利用ください。

セルフホストには Node.js 20+、Python 3、および対応する [ms-swift](https://github.com/modelscope/ms-swift) の推論環境が必要です。Release の全ファイルをダウンロードし、モデルを復元してからバックエンドをビルドします。

```bash
gh release download v0.1.0 --repo ZHENYI-ORG/zhenyi-mingli-ai --dir model-assets
python3 scripts/reconstruct-model.py model-assets model/zhenyi
npm ci
npm run build
```

一つ目のターミナルでモデルサービスを起動します。

```bash
export MODEL_PATH="$PWD/model/zhenyi"
export SWIFT_BIN=/path/to/swift
bash scripts/start-model-service.sh
```

二つ目のターミナルで真一のバックエンドと Web 画面を起動します。

```bash
export ZHENYI_MODEL_BASE_URL=http://127.0.0.1:8000/v1
export ZHENYI_MODEL_NAME=ZHENYI
export PORT=8787
bash scripts/start-web.sh
```

メモリ要件、アクセスキー、その他の設定は [導入ガイド](docs/MODEL_INTEGRATION.md)をご覧ください。

## API の使用

クライアントは通常のチャット形式で送信できます。命例の検出と排盤はバックエンドが担当します。

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"ZHENYI","messages":[{"role":"user","content":"乾造，四柱为甲子 甲戌 戊寅 庚申。请分析事业。"}]}'
```

OpenAI 互換 SDK では `base_url` を `http://localhost:8787/v1`、モデル名を `ZHENYI` に設定します。複数ターンの会話とストリーミング応答に対応します。

## オープンソースにした理由

盲派、旺衰派、子平派、調候派は、それぞれ命理の一部を捉えていると考えています。難しいのは、同じ命例で各流派の見方を検証し、判断が分かれるときに根拠を説明することです。真一は盲派から出発しながら、ほかの流派の知見にも向き合います。

命例、フィードバック、実践者の経験が集まることで、真一が独自の一貫した解釈方法を築いていくことを期待しています。いつか現在の人間の説明の範囲を超えるかもしれませんが、それは今後の検証を要する目標です。

排盤の検証、解釈の議論、誤りの報告、よりよい評価方法の提案に、実践者・研究者・開発者が参加できるよう、このプロジェクトを公開しました。

## ライセンスと引用

- ソースコード：[MIT License](LICENSE)。
- 真一が権利を持つ統合済みモデルと微調整部分：[Apache License 2.0](LICENSE-MODEL)。ベースモデルの著作権と元のライセンスも適用されます。[モデルの告知](NOTICE-MODEL.md)と[第三者の告知](THIRD_PARTY_NOTICES.md)をご確認ください。適用される条件に従って改変・再配布できます。
- 研究や開発で利用した場合の引用例：

```bibtex
@misc{zhenyi2026,
  title        = {ZHENYI: An Open-Source Bazi Astrology Language Model},
  author       = {{ZHENYI-ORG}},
  year         = {2026},
  howpublished = {\url{https://github.com/ZHENYI-ORG/zhenyi-mingli-ai}}
}
```

## Star History

[![真一の GitHub Star 推移](https://api.star-history.com/svg?repos=ZHENYI-ORG/zhenyi-mingli-ai&type=Date)](https://star-history.com/#ZHENYI-ORG/zhenyi-mingli-ai&Date)

Star History がリポジトリの公開 Star データから動的に生成するグラフです。プロジェクトは公開されたばかりです。画像をクリックすると最新のデータを確認できます。
