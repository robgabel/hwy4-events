"""Where a week's files live, in any environment.

claude.ai sandbox: /mnt/user-data/outputs/weekend-YYYY-MM-DD/   (visible to the user)
anywhere else (Claude Code in the repo): ./out/weekend-YYYY-MM-DD/  (add out/ to .gitignore)
Override with HWY4_REEL_OUT=/some/dir.
"""
import os
from pathlib import Path

SANDBOX = Path("/mnt/user-data/outputs")


def out_root():
    if os.environ.get("HWY4_REEL_OUT"):
        return Path(os.environ["HWY4_REEL_OUT"])
    return SANDBOX if SANDBOX.is_dir() else Path.cwd() / "out"


def week_dir(friday):
    d = out_root() / f"weekend-{friday}"
    d.mkdir(parents=True, exist_ok=True)
    return d
