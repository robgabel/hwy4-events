"""Where a week's files live, in any environment.

claude.ai sandbox: /mnt/user-data/outputs/weekend-YYYY-MM-DD/   (visible to the user)
inside a git checkout (Claude Code in the repo): <repo root>/out/weekend-YYYY-MM-DD/,
  wherever the session's cwd is. hwy4-events ignores the root-anchored /out/, so a
  session that has cd'd into scripts/ must not write an unignored scripts/out/.
anywhere else: ./out/weekend-YYYY-MM-DD/
Override with HWY4_REEL_OUT=/some/dir.
"""
import os
from pathlib import Path

SANDBOX = Path("/mnt/user-data/outputs")


def repo_root():
    """The checkout this skill is committed in, else the one the cwd sits in, else None."""
    here = Path(__file__).resolve()
    # committed at <root>/.claude/skills/<skill>/scripts/paths.py
    if len(here.parents) > 4 and here.parents[3].name == ".claude" and (here.parents[4] / ".git").exists():
        return here.parents[4]
    cwd = Path.cwd().resolve()
    for d in (cwd, *cwd.parents):
        if (d / ".git").exists():
            return d
    return None


def out_root():
    if os.environ.get("HWY4_REEL_OUT"):
        return Path(os.environ["HWY4_REEL_OUT"])
    if SANDBOX.is_dir():
        return SANDBOX
    return (repo_root() or Path.cwd()) / "out"


def week_dir(friday):
    d = out_root() / f"weekend-{friday}"
    d.mkdir(parents=True, exist_ok=True)
    return d
