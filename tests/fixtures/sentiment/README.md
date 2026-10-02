# Sentiment fixture corpus

Everything in this directory is **synthetic and hand-authored**. Fixtures
encode the documented or reverse-engineered shapes of real sources, but no
real transcript, conversation log, or personal message text is ever committed
here.

Real transcripts from Ryan's Macs are used for verification locally only, and
only aggregate numbers (counts) are ever recorded back into Kanbus or docs.

Per-source subtrees:

- `claude-code/` — Claude Code session JSONL shapes (`~/.claude/projects`)
- `cursor-home/` — Cursor agent-transcript JSONL shapes
  (`~/.cursor/projects/<sanitized>/agent-transcripts/<sid>/<sid>.jsonl`;
  IDE `state.vscdb` fixtures are generated at test time, not committed;
  chats metadata fixtures at `chats/<hash>/<sid>/meta.json`)
- `codex/` — Codex CLI rollout JSONL shapes (`~/.codex/sessions`)

A CI lint guard rejects files in this tree that look like real session dumps.
