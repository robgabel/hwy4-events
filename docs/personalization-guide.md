# Claude Code Personalization Guide

How to review past sessions, identify patterns, and configure Claude to work the way you work.

---

## 1. The Three Layers of Personalization

| Layer | File | Scope | Committed to git? |
|-------|------|-------|--------------------|
| **Global (you)** | `~/.claude/CLAUDE.md` | All projects, all sessions | No — lives on your machine |
| **Project (team)** | `./CLAUDE.md` | This repo, all collaborators | Yes — shared with team |
| **Project (personal)** | `.claude/settings.local.json` | This repo, just you | No — gitignored |

**Rule of thumb:** If it's about *you* (communication style, UX sensibility), put it in global. If it's about *the project* (architecture, conventions, commands), put it in project-level.

## 2. How to Review Past Sessions for Patterns

### What to look for

**Repeated corrections** — Where do you keep fixing the same thing?
- "Make the click target the full card, not just the title" → Add to CLAUDE.md: "Wrap full card in Link for tap targets"
- "Too many emojis" → Add: "No emojis in body text"
- "That's too verbose" → Add to global: "Be concise. Lead with action."

**Iterative refinement chains** — What gets v2'd and v3'd?
- If copy always gets shortened after the first draft → Note your preference for brevity
- If mobile bugs follow desktop changes → Note mobile-first requirement

**Things you never have to correct** — These tell you what's already working. Don't clutter CLAUDE.md with instructions for things that already happen naturally.

**Decision patterns** — When you face a fork, which way do you go?
- "Use the simpler approach" → You value simplicity
- "How much does that API call cost?" → You're cost-conscious
- "Let's write a PRD first" → You plan before building

### Where to find session history

1. **Git log** — Your commit messages are a goldmine:
   ```bash
   git log --oneline -50
   ```
   Look for patterns: fix chains, feature→polish sequences, what gets reverted.

2. **PR descriptions** — Review your merged PRs for recurring themes:
   ```bash
   gh pr list --state merged --limit 20
   ```

3. **Claude's auto-memory** — Check what Claude has already learned:
   ```
   ~/.claude/projects/<project-hash>/memory/
   ```

4. **This session** — Ask Claude: "What patterns have you noticed in how I work?"

## 3. What Makes a Good CLAUDE.md

### Do include
- Build/test/lint commands
- Architecture decisions that aren't obvious from code
- Naming conventions that differ from defaults
- Non-obvious project constraints (timezone handling, API cost limits)
- Voice/tone guidelines for generated content
- Key file locations for orientation

### Don't include
- Things Claude can infer from reading the code
- Standard language conventions (TypeScript naming, React patterns)
- Long tutorials or explanations
- Information that changes frequently
- "Write clean code" or other vague instructions

### Size target
**Under 200 lines.** Longer files dilute important instructions. If you need more, use:
- `.claude/rules/` files with path-scoping (e.g., rules that only apply to `scripts/scrapers/`)
- `.claude/skills/` for domain-specific workflows that load on demand

## 4. Maintaining Your Personalization Over Time

### Monthly review (5 minutes)
1. Scan your last month of commits — any new patterns?
2. Check if any CLAUDE.md rules are now outdated
3. Remove instructions for things that happen correctly without them
4. Add instructions for things you keep correcting

### After major features
- Did you discover new conventions? Add them.
- Did architecture change? Update the Architecture section.
- New commands or tools? Update Commands section.

### Signals to update
- You've corrected Claude on the same thing 3+ times → Add a rule
- A CLAUDE.md rule hasn't been relevant in weeks → Remove it
- You've added a new tool/service → Document the key commands
- Your team's conventions evolved → Update accordingly

## 5. Advanced: Hooks for Non-Negotiable Rules

CLAUDE.md is advisory (~80% compliance). For rules that **must** be followed every time, use hooks in `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "npx eslint --fix $CLAUDE_FILE_PATH 2>/dev/null || true"
      }]
    }]
  }
}
```

Good candidates for hooks:
- Auto-formatting after file edits
- Lint checks before commits
- Git state validation on session end (you already have this!)

## 6. Quick-Start Checklist

- [x] Create `./CLAUDE.md` with project context, commands, and conventions
- [x] Create `~/.claude/CLAUDE.md` with personal working-style preferences
- [ ] Review git log monthly for new patterns
- [ ] Add `.claude/rules/` files for path-specific conventions as needed
- [ ] Prune stale instructions quarterly
