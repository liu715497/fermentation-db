"""把本機擷取結果推到新分支並開合併請求。需已安裝 git；有 GitHub CLI（gh）時自動開 PR。"""

from __future__ import annotations

import shutil
import subprocess

from pipeline import config


def _git(*args: str) -> str:
    res = subprocess.run(["git", *args], cwd=config.ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} 失敗：{res.stderr.strip()}")
    return res.stdout.strip()


def run() -> str:
    if not shutil.which("git"):
        raise SystemExit("找不到 git，請先安裝")
    if not _git("status", "--porcelain", "data/literature"):
        return "data/literature 沒有變更，不需提交"
    if _git("ls-files", ".env"):
        raise SystemExit(".env 已被版本管理追蹤，請先執行 git rm --cached .env，避免金鑰上傳")
    branch = "extract/" + config.now().strftime("%Y%m%d-%H%M%S")
    _git("checkout", "-b", branch)
    _git("add", "data/literature")
    _git("commit", "-m", f"文獻擷取結果 {config.now_str()}")
    _git("push", "-u", "origin", branch)
    if shutil.which("gh"):
        subprocess.run(["gh", "pr", "create", "--fill", "--base", "main"], cwd=config.ROOT, check=False)
        return f"已推送 {branch} 並嘗試建立合併請求"
    return f"已推送 {branch}；請到 GitHub 倉庫頁面按「Compare & pull request」建立合併請求"
