---
feature: loop
status: delivered
updated: 2026-09-12
branch: feat/loop
commits: a7787c6..b6e406a
---

# Loop

## Report

**What was built** - A single-file OpenCode V2 plugin that runs a prompt on a
fixed cadence. `/loop every <interval> <prompt>` registers a loop, `/loop list`
shows them, and `/loop stop <id|all>` removes them. A tick posts the prompt to
the session and marks the loop active; the session's turn-end event clears the
flag, so a slow run does not stack. One loop per session. Definitions persist,
loops re-arm when the plugin loads, and timers stop when it unloads.

**Verification** - `bun test`: 16 pass, 0 fail, 48 assertions. Live: a 30 second
loop fired twice in 75 seconds with two replies; `/loop list` showed the loop as
completed; `/loop stop all` cleared it. Two review rounds covered four blocking
items plus mediums and lows; all are resolved.

**Journey log**

1. Only `succeeded` cleared the active flag, so a failed or interrupted run
   wedged a loop forever. All three turn-end events now clear it.
2. A flag persisted from a previous load was never reset. `setup` resets it
   before arming.
3. One success event cleared every loop on a session, so the plugin now allows
   one loop per session and the turn-end event maps cleanly to that loop.
4. Intervals above the 32-bit timer limit fired at 1ms. `parseInterval` rejects
   them.

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

- [x] T1: the /loop command family with add, list, and stop - acceptance: a
      fake-context test round-trips a loop and rejects a bad interval (covers:
      S2)
- [x] T2: timer scheduling and re-arm on setup, with cleanup on unload -
      acceptance: a test with an injected clock fires a loop, skips a run while
      one is active, and clears timers on cleanup (covers: S2; depends: T1)
- [x] T3: run reporting per loop - acceptance: the record shows skipped,
      completed, and failed states (covers: S2; depends: T2)
- [x] T4: README and NOTICE - acceptance: both files exist and name the MiMoCode
      loop skill as the inspiration (covers: S2; depends: T2)
