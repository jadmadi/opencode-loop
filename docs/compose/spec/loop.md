---
feature: loop
status: in-progress
updated: 2026-09-12
branch: feat/loop
commits:
---

# Loop

## Report

## [S1] Problem

OpenCode V2 has no scheduling. A recurring prompt, such as a periodic health
check or a repeated review, must be started by hand each time. MiMoCode has a
`/loop` skill that runs a prompt on a fixed cadence.

## [S2] Design

A command registers a recurring prompt, and a plugin timer runs it.

- `/loop every <interval> <prompt>` registers a loop. `/loop list` prints the
  loops. `/loop stop <id>` removes one. `/loop stop all` removes every loop.
- The interval parses a small set of forms: `30s`, `5m`, `2h`, and `1d`.
- The timer posts the prompt to the session that created the loop. One loop per
  session, because the turn-end event names the session, not the run. A run that
  is still active is skipped, so a slow run does not stack.
- Loop definitions live in `ctx.storage` under `loops`. On plugin setup, defined
  loops re-arm while the server runs. `setup` returns a cleanup function that
  clears every timer.
- A loop reports each run as skipped, completed, or failed in its record.

## [S3] Out of Scope

- Cron expressions and calendars.
- A TUI schedule manager.
- Loops that survive a server restart (storage persists, timers do not).
- Cost controls beyond the skip-if-active rule.

## Tasks

- [ ] T1: the /loop command family with add, list, and stop - acceptance: a
      fake-context test round-trips a loop and rejects a bad interval (covers:
      S2)
- [ ] T2: timer scheduling and re-arm on setup, with cleanup on unload -
      acceptance: a test with an injected clock fires a loop, skips a run while
      one is active, and clears timers on cleanup (covers: S2; depends: T1)
- [ ] T3: run reporting per loop - acceptance: the record shows skipped,
      completed, and failed states (covers: S2; depends: T2)
- [ ] T4: README and NOTICE - acceptance: both files exist and name the MiMoCode
      loop skill as the inspiration (covers: S2; depends: T2)
