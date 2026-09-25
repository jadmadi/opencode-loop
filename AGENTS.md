# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`loop.ts`) that runs a prompt on a fixed cadence. No
build step, no dependencies, AGPL-3.0-only.

## Local development

```sh
bun test
cp loop.ts ~/.config/opencode/plugins/loop.ts
touch ~/.config/opencode/plugins/loop.ts
```

Check the server log when something is off:

```sh
grep loop ~/.local/share/opencode/log/opencode.log | tail
```

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free.
- Plugin `console` output is not visible to users. A command surfaces messages
  only by throwing.
- Never post a synthetic message for a notice; it starts a model turn.

## API notes

- Loop definitions live in `ctx.storage` under `loops`.
- `setup` arms one `setInterval` per loop and returns a cleanup that clears the
  timers and aborts the event subscription. Keep the timer function injectable
  so tests can drive it.
- A tick calls `ctx.session.prompt({ sessionID, text })` and marks the loop
  active. The session's execution end event clears the flag: `succeeded` marks
  completed, `failed` marks failed, and `interrupted` marks skipped.
- One loop per session, because the event names the session, not the run. The
  command rejects a second loop for the same session.
- `setup` resets any stored `active` flag before arming, since an event that
  would have cleared it already passed.
- All storage mutations run through a promise chain so concurrent ticks and
  events cannot lose writes.
- `parseInterval` accepts `s`, `m`, `h`, and `d`.

## Layout

- `parseInterval` - interval parsing, exported for tests.
- `loadLoops`, `saveLoops`, `addLoop`, `removeLoop` - storage helpers.
- `tickLoop` - one run, exported for tests.
- `armLoop` - schedules a loop with an injectable timer, exported for tests.
- `setup` - registers the command, arms loops, and watches events.
- `loop.test.ts` - tests with a fake ctx and timer.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.
