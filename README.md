# sphntr-hidden-spec-cli-01

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/pranz73/sphntr-hidden-spec-cli-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/pranz73/sphntr-hidden-spec-cli-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is one patch tool for every AI edit format. It takes an edit expressed as JSON edits, a unified diff, a search-and-replace block, or a V4A patch, works out which format it is, and applies it to the working files with the spec's exact output lines and exit codes — including file moves, whitespace-tolerant matching, final-newline handling, CRLF files, and a `--check` mode that reports without writing. All 300 practice checks pass across the three trial instances, plus focused checks for CLI errors and malformed patches.

## Run it

```sh
node main.ts
```

The entrypoint follows the competition harness contract; invoked directly it applies the patch described on its input to the files in the working directory.

---
<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
