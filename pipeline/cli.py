"""指令列入口：python -m pipeline <指令>。"""

from __future__ import annotations

import argparse
import sys

from pipeline import config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fdb", description="發酵資料庫資料處理工具（測試版）")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("fetch", help="查詢 PMC，更新候選清單與書目（GitHub Actions 執行）")
    p.add_argument("--claim", default="glycemic")
    p = sub.add_parser("extract", help="以本機 .env 設定的 AI 擷取候選文獻")
    p.add_argument("--claim", default="glycemic")
    p.add_argument("--limit", type=int, default=None, help="本次最多處理幾篇")
    p = sub.add_parser("validate", help="檢核 data/ 內所有檔案")
    p.add_argument("--strict", action="store_true", help="「待填」欄位視為錯誤（上線前使用）")
    sub.add_parser("build", help="產生網站資料檔 data/build/*.json")
    sub.add_parser("submit", help="把擷取結果推到新分支並開合併請求")
    args = parser.parse_args(argv)

    if args.cmd == "fetch":
        from pipeline import fetch
        from pipeline.ncbi import NcbiClient

        env = config.load_env()
        result = fetch.run(args.claim, NcbiClient(env.get("NCBI_EMAIL", ""), env.get("NCBI_API_KEY", "")))
        print(f"查詢命中 {result['search_hits']} 篇；新增書目 {result['new_articles']} 篇、"
              f"候選 {result['new_candidates']} 篇；授權不明 {result['unknown_license']} 篇")
    elif args.cmd == "extract":
        from pipeline import extract, providers
        from pipeline.ncbi import NcbiClient, bioc_to_text

        env = config.load_env()
        provider = providers.from_env(env)
        client = NcbiClient(env.get("NCBI_EMAIL", ""), env.get("NCBI_API_KEY", ""))
        print(f"使用 {provider.name} / {provider.model} 擷取…")
        try:
            stats = extract.run(args.claim, provider, env, args.limit,
                                get_text=lambda pmcid: bioc_to_text(client.fetch_fulltext_bioc(pmcid)))
        except providers.ProviderError as exc:
            print(f"AI 服務錯誤，已保存完成的部分後停止：{exc}", file=sys.stderr)
            return 2
        print(f"完成 {stats['done']} 篇、失敗 {stats['failed']} 篇、授權不明略過 {stats['skipped_license']} 篇、"
              f"先前已完成 {stats['already_done']} 篇")
    elif args.cmd == "validate":
        from pipeline import validate

        report = validate.run(strict=args.strict)
        for w in report.warnings:
            print(f"警告：{w}")
        for e in report.errors:
            print(f"錯誤：{e}", file=sys.stderr)
        print("檢核通過" if report.ok else f"檢核失敗：{len(report.errors)} 個錯誤")
        return 0 if report.ok else 1
    elif args.cmd == "build":
        from pipeline import build

        result = build.run()
        print(f"已建置：擷取結果 {result['findings']} 筆、組合 {result['combinations']} 個")
    elif args.cmd == "submit":
        from pipeline import submit

        print(submit.run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
