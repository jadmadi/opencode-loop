# opencode-loop

An OpenCode V2 plugin that runs a prompt on a fixed cadence.

## OpenCode

This plugin runs on OpenCode. New accounts through my referral link get $5 in
usage credits, and I get $5 too:

https://opencode.ai/go?ref=N9H3ZEP22A

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-loop/main/loop.ts \
  -o ~/.config/opencode/plugins/loop.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode v2.0.3.

To pin a release, replace `main` in the URL with a tag such as `v0.1.0`.

## Use

| Command                       | Effect                              |
| ----------------------------- | ----------------------------------- |
| `/loop every 30m <prompt>`    | Register a loop                     |
| `/loop` or `/loop list`       | List the loops                      |
| `/loop stop <id>`             | Remove one loop                     |
| `/loop stop all`              | Remove every loop                   |

Intervals accept `s`, `m`, `h`, and `d`: `30s`, `5m`, `2h`, `1d`.

A tick posts the prompt to the session that created the loop. A tick is skipped
while the previous run is still active, and the loop becomes active again when
that session emits its turn-end event: `session.execution.succeeded`,
`session.execution.failed`, or `session.execution.interrupted`.

## Notes

- Loops live in the server process. They re-arm when the plugin loads and stop
  when it unloads. Definitions persist in storage, so they come back on the next
  load, but they do not fire between loads.
- One loop per session. The turn-end event names the session, not the run, so a
  second loop could not tell whose run finished. The plugin rejects a second.
- A run record shows `completed`, `skipped`, or `failed`. The status is the most
  recent outcome, so a later turn end can replace an earlier skip. A failed or
  interrupted run clears the active flag, so the loop keeps going.
- Command output has no normal channel, so list is surfaced as a command error
  message.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's loop skill. See `NOTICE`.

## License

MIT
