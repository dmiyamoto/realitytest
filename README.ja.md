# RealityTest（日本語）

**物理世界のためのユニットテスト。**

RealityTest は、短い動画から物理的なタスクの成否を判定するオープンソースアプリです。
最初のユースケースはロボットのピック＆プレース。動画をアップロードし、対象物（例: `red cube`）を指定して、
目標領域（例: 青いトレイ）を描くと、**Meta SAM 3.1** が物体をフレームごとに追跡し、
**決定論的なジオメトリエンジン**が `PASS` / `FAIL` / `INCONCLUSIVE` を返します。

- PASS: 最後の有効観測5件のうち3件以上で、マスク重心が目標ポリゴン内。かつ以前は領域外で観測されていること、追跡カバレッジが十分であること、物体の曖昧さがないこと
- FAIL: カバレッジが十分で、最終フレームで物体が**見えたまま**領域外にある
- INCONCLUSIVE: 未検出・複数候補・カバレッジ不足・最後に見失った/遮蔽・API失敗など

判定は**2D画像平面上の幾何**に基づきます。3Dでの収納や接触を証明するものではなく、安全認証でもありません。

## 使い方

```bash
pnpm install
cp env.example .env.local   # MODEL_API_KEY, SESSION_SECRET を設定
pnpm db:push
pnpm dev                    # http://localhost:3000
pnpm worker                 # 別ターミナルでジョブワーカー
```

Docker: `docker compose up --build`

## 表示ラベル（出所）

- **Live Meta SAM 3.1**: この評価のために実際にAPIを呼び出した結果
- **Recorded API fixture**: 過去の実API応答を記録・再生したもの（ライブ推論としては表示しません）
- **Synthetic test data — not model output**: 自動E2Eテストのみが投入する合成データ

## 課金（任意・既定でオフ）

Stripe 課金は `BILLING_ENABLED=true` のときだけ有効です。オフのときは料金ページと購入ボタンが表示されず、
`/api/checkout` と `/api/stripe/webhook` は 404 を返します。ライブ評価は無料で、
`FREE_EVALUATIONS_PER_SESSION`（既定20回）と `MAX_LIVE_EVALUATIONS_PER_DAY`（既定100回）で上限を設けます。
フラグはリクエストごとに読むので、切り替えに再ビルドは不要です。

オンにした場合は Stripe テストモードで $9 / 20クレジット。クレジットは署名検証済みの Webhook でのみ付与され、
success URL へのアクセスでは付与されません。本番キーは既定で拒否します。

## ドキュメント

[アーキテクチャ](docs/ARCHITECTURE.md) ・ [テスト結果](docs/TEST_RESULTS.md)

ライセンス: MIT
