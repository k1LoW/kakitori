---
name: register-kakitori-questions
description: kakitori.page の question 素材を import key を使ってノートへ登録・削除・入れ替えする。問題ファイル1つ、問題ファイルの入ったディレクトリ、あるいは「小2の漢字10語」のような未作成の語リストなど、入力の形がどれであっても受け取り、検証を通してから import API (POST / DELETE /api/v1/notes/:key/questions) へ送る。ユーザーが「kakitori.page に登録して」「問題をノートに入れて」「作った question を反映して」「import key で登録」「ノートを入れ替えて (replace)」「間違えて登録した問題を直したい」「特定の問題だけ削除して」「登録済みの問題一覧が見たい」「pausedになった問題を確認したい」などに言及したら必ずこのスキルを使うこと。登録・削除は外部サービスへの書き込みで replace と force 削除は不可逆なので、素手で fetch を書かず必ずこのスキルの手順とスクリプトを使う。
---

# kakitori.page のノート操作 (import key)

kakitori.page の question は「問題素材」で、ノート単位で管理される。このスキルは**手元の question を検証済みの状態で import API へ確実に登録し、必要なら個別問題を削除・入れ替える**ためのもの。$schema の除去・100件バッチ分割・replace の安全な扱い・force 削除の確認・キーのマスクは同梱スクリプトが担うので、素手で fetch を組み立てない。

question ファイルそのものの作り方 (表層形ふりがな・segments・例文の規則) は姉妹スキル `create-kakitori-questions` の領分。このスキルはその成果物を登録・保守する側。

## このスキルが扱うAPI

| 操作 | エンドポイント | 用途 | このスキルのスクリプト |
|---|---|---|---|
| 登録 | `POST /api/v1/notes/:key/questions` | 一括登録 (append / replace) | `register.mjs` |
| 一覧 | `GET /api/v1/notes/:key/questions?status=…` | id・状態・件数の確認 | `list.mjs` |
| 削除 | `DELETE /api/v1/notes/:key/questions/:qid` | 誤登録の物理削除 | `delete.mjs` |

すべて import key を要求する (一覧は play key でも `?status=active` のみ可、`paused` / `all` は import key 限定)。

## 入力の受け取り

入力は次のいずれか。まず種別を見分けてから進む。

- **単一の question ファイル** (`学校-がっこう.json` など)。そのまま登録対象にする
- **ディレクトリ**。中の `*.json` をすべて登録対象にする
- **未作成の情報** (「小2の漢字10語」「学校・花火・大きい を登録して」など、ファイルがまだ無い語リストや学年・単元指定)。この場合はまず `create-kakitori-questions` スキルでファイルを生成・検証し、そのうえで登録に進む。作成から登録までを一気通貫でやりきる
- **修正の依頼** (「登録した◯◯を直したい」「segments を打ち間違えた」など)。これは新規登録ではなく「既存問題の入れ替え」ワークフロー。後述の `個別問題の削除・入れ替え` に進む

判断に迷ったら、渡されたパスが実在するか (ファイルかディレクトリか) を確認する。実在しなければ未作成の情報として扱い、作成側スキルに回す。

## import key の解決

登録・削除には**ノートの import key** が要る。これは書き込み権限を持つ秘密情報であり、同時にどのノートを対象にするかの識別子も兼ねる (ノートには練習用の play key と登録用の import key があり、書き込みに使うのは import key)。

1. 環境変数 `KAKITORI_IMPORT_KEY` を第一に使う
2. 未設定ならユーザーに import key を尋ねる。会話やログにキー全体を書き出さない (スクリプトは末尾4文字だけ表示してマスクする)

スクリプトへは環境変数経由か `--key` で渡す。`--key` を使うとコマンド全体にキーが載るので、可能なら環境変数を優先する。

## 登録前の検証 (必須)

サーバーはスキーマと整合性ルールで厳密に検証し、1件でも不正なら**そのバッチ全体が失敗する**。登録してから気付くと部分的に入って状態が読みにくくなるので、送る前に必ずローカル検証を通す。

```console
$ node ../create-kakitori-questions/scripts/validate.mjs <対象のファイルまたはディレクトリ>
```

(パスはこのスキルのディレクトリ `register-kakitori-questions/` からの相対。作成側スキルの検証器を再利用する)

検証が1件でも失敗したら登録に進まない。表層形ふりがなの誤りなどは `create-kakitori-questions` の規則に沿って直す。全ファイルが pass してから次へ。

## 登録の実行

```console
$ node <このスキルのディレクトリ>/scripts/register.mjs [--mode append|replace] [--dry-run] <ファイルまたはディレクトリ> ...
```

スクリプトがやること。

- 各ファイルから `$schema` を除去する (サーバーは `additionalProperties: false` で `$schema` を拒否する)
- 100件ごとにバッチ分割して `POST /api/v1/notes/:key/questions` へ送る (1リクエスト最大100件)
- バッチごとに成否を表示し、失敗したバッチはサーバーのエラー (`error.code` / `error.message`) と該当ファイル名を出す
- import key はマスクして表示する

### まず --dry-run で見せる

いきなり本番送信せず、`--dry-run` で「何件を・どのモードで・どのノート (マスク済み) へ送るか」をユーザーに提示してから実行するとよい。特に件数やモードの取り違えをここで防げる。

```console
$ node <このスキルのディレクトリ>/scripts/register.mjs --dry-run --mode append questions/
```

## mode (append / replace) の扱い

`mode` は既定で **append** (ノートに追記)。

**replace はノートの既存 question をすべて置き換える (実体は「リストに無い active 問題を paused に落とし、リストにある paused を active に戻す」同期処理) 操作**なので、実行する前に必ずユーザーへ「このノートの既存問題を全部置き換えます。よいですか」と明示的に確認を取る。指示に replace が含まれていても、確認なしで送らない。

replace は結果を保存する (paused に落ちた問題の id と回答実績はそのまま残り、後で `replace` に含まれれば active に復帰する)。ただし「学習履歴を含めて完全に消したい」ときは replace では足りず、個別 DELETE (下記) が要る。

登録件数が100を超えて replace するときは、先頭バッチだけ replace、以降は append になる (スクリプトが自動でそうする)。全バッチに replace を送ると2バッチ目が1バッチ目の追加分を消してしまうためで、「ノート全体をこのN件にする」という replace の意図はこの降格で保たれる。

## 登録済み問題の一覧・確認

qid や現在の状態 (active / paused) の確認には `list.mjs` を使う。id は削除やデバッグの入口になる。

```console
$ node <このスキルのディレクトリ>/scripts/list.mjs [--status active|paused|all] [--chars 学校] [--sort weakest] [--limit 100]
```

- `--status active` (既定): ゲームから見える問題だけ
- `--status paused`: replace で出題対象から外れた問題だけ。**import key 限定**
- `--status all`: active + paused。**import key 限定**。誤って paused に落ちた問題を拾い直すときはこれ
- 出力は `id / status / attempts / word (reading)` の表。`--format json` で生レスポンスも取れる

`?status=paused` / `?status=all` を play key で叩くとサーバーは 403 `invalid_key` を返す (存在推測を防ぐ設計)。この403は「キーが違う」ではなく「その key ではその status を見られない」意味なので、import key を使い直す。

## 個別問題の削除・入れ替え

問題は immutable (登録後に segments や sentences を書き換えるAPIは無い) なので、「誤登録した1問を直す」は次の2ステップ。

1. `DELETE /api/v1/notes/:key/questions/:qid` で誤った問題を消す
2. 修正済みファイルを `POST /api/v1/notes/:key/questions` (`mode append`) で登録し直す

**なぜ pause + 再登録ではダメか**。`word` + `reading` の一意制約は paused 行にも効くので、古い行を残したまま同じ word/reading の直しは登録できない。物理削除でスロットを空ける必要がある。

### ワークフロー

1. `list.mjs --status all --chars <その語の文字>` で対象問題を探し、`id` を得る
   - `--chars` は `word` に含まれる文字での絞り込み。ノート全体を舐めるより早く該当行に辿り着ける
2. `delete.mjs --dry-run <qid>` でどのノートのどの id を落とすかユーザーに提示する
3. `delete.mjs <qid>` で消す (`--force` はまだ付けない)
4. **もしサーバーが 409 `question_has_results` を返したら**、その問題には既に回答結果 (`attempts` 件) が紐づいている。ここでユーザーに「回答履歴も一緒に消えます (`attempts` 件)。よいですか」と明示的に確認してから `delete.mjs --force <qid>` を実行する。**確認なしで `--force` を付けない**
5. 修正版の question ファイルを (必要なら `create-kakitori-questions` の検証を通してから) `register.mjs --mode append <修正版.json>` で登録

### `--force` の意味

- `--force` 無し: 結果が1件でも紐づいている問題の削除は409で拒否される。学習履歴を巻き添えにする破壊を「意図的な操作」に限定するためのセーフティで、これが標準の挙動
- `--force` 付き: `results` と `result_chars` / `result_char_mistakes` と R2 の payload まで CASCADE で消える不可逆操作。**結果まで消してよいと確認できた場合だけ付ける**。レスポンスの `deletedResults` は実際に消えた結果件数

### 削除失敗の見分け方

- **403 `invalid_key`**: play key を渡した / キーが rotate された / 別ノートの key
- **404 `question_not_found`**: qid が存在しない / 別ノートの qid を渡した。`list.mjs` で id を取り直す
- **409 `question_has_results`**: 結果が付いている。上の (4) の手順で確認してから `--force`
- **400 `invalid_request` (force must be 'true' or 'false')**: `--force` の値が不正 (通常はスクリプト経由なら起きない)

## ワークフロー (総合)

1. 入力の種別を見分ける
   - **新規登録**: 未作成の情報なら `create-kakitori-questions` で作成・検証してから登録に回る
   - **修正**: `個別問題の削除・入れ替え` の手順に入る
2. import key を解決する (環境変数、なければ確認)
3. **登録**: `validate.mjs` で全ファイルを検証。1件でも失敗したら直してから再検証。全 pass まで進まない
4. **登録**: `register.mjs --dry-run` で送信内容 (件数・モード・対象ノート) をユーザーに提示する
5. **登録**: append ならそのまま実行。replace なら「既存を全置換します」と確認を取ってから実行する
6. **修正**: `list.mjs` で qid を確定 → `delete.mjs --dry-run` で見せる → `delete.mjs` で削除。結果ありなら追加確認を取ってから `--force` → `register.mjs --mode append` で修正版を投入
7. スクリプトの出力を読み、失敗があればエラー内容 (キー種別違い・字形データ無し・整合性違反・question_not_found・question_has_results など) に応じて対処し、再送する。**全ステップが成功するまで完了としない**

## よくある失敗

- **`invalid_key`**。play key を使っている、キーが rotate された、別ノートのキーを渡している。import key を確認する。`?status=paused` / `?status=all` を play key で叩いたときもこのコードで返る
- **422 など整合性エラー**。字形データの無い文字、表層形ふりがなの不一致など。`validate.mjs` を通していれば大半は事前に防げる。オンラインで字形データ存在チェックまで済ませておく
- **word + reading の重複**。word と reading の組はノート内で一意 (paused 行も含む)。append で既存と衝突するとサーバーが弾く。**誤登録の修正はこの重複に必ずぶつかるので、先に `delete.mjs` で古い行を落としてから登録する**
- **`question_not_found` (404)**。qid のタイプミス、または別ノートの qid。`list.mjs` で再確認する
- **`question_has_results` (409)**。結果が付いている問題を素の DELETE で消そうとした。回答履歴ごと消す覚悟が固まったらユーザー確認を取り `--force`
