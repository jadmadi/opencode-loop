# Contributing

Thanks for helping improve opencode-loop.

## Setup

```sh
git clone https://github.com/jadmadi/opencode-loop
cd opencode-loop
bun test
```

Bun is a deliberate exception to the global no-bun rule here: the plugin runs
inside OpenCode, which embeds Bun.

## Rules

- No imports in the plugin. Export a plain `{ id, setup }` object.
- Keep timers injectable so tests can drive them without sleeping.
- Add a test for any behavior you change.

## Sending a change

1. Branch: `git checkout -b fix/short-description`.
2. Make the change and add tests.
3. Run `bun test`.
4. Use a semantic commit message.
5. Open a pull request against `main`.

## License

By contributing, you agree that your work is released under the MIT License.
