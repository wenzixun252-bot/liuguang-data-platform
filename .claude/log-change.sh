#!/bin/bash
# Claude Code hook: 每次 Edit/Write 后记录变更到 CHANGELOG-claude.md
LOGFILE="d:/CC/liuguang-data-platform/CHANGELOG-claude.md"
python "d:/CC/liuguang-data-platform/.claude/log-change.py" "$LOGFILE" <<< "$(cat)"
