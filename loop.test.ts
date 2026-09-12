import { describe, expect, test } from "bun:test"
import plugin, { armLoop, handleEvent, loadLoops, parseInterval, tickLoop } from "./loop.ts"

function makeCtx() {
  const store = new Map<string, unknown>()
  const prompts: any[] = []
  const commands: any[] = []
  const ctx: any = {
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      remove: async (key: string) => void store.delete(key),
    },
    session: {
      prompt: async (input: any) => {
        if (input?.text === "THROW") throw new Error("prompt failed")
        prompts.push(input)
      },
    },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
    event: { subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  }
  return { ctx, store, prompts, commands }
}

const seed = (ctx: any, overrides: Record<string, unknown> = {}) => {
  const loop = {
    id: "abc123",
    sessionID: "ses_1",
    prompt: "check the build",
    intervalMs: 60_000,
    interval: "1m",
    active: false,
    ...overrides,
  }
  return ctx.storage.set("loops", [loop]).then(() => loop)
}

describe("parseInterval", () => {
  test("parses the supported units", () => {
    expect(parseInterval("30s")).toBe(30_000)
    expect(parseInterval("5m")).toBe(300_000)
    expect(parseInterval("2h")).toBe(7_200_000)
    expect(parseInterval("1d")).toBe(86_400_000)
    expect(parseInterval("5M")).toBe(300_000)
  })

  test("rejects bad input", () => {
    expect(parseInterval("5x")).toBeUndefined()
    expect(parseInterval("")).toBeUndefined()
    expect(parseInterval("0s")).toBeUndefined()
    expect(parseInterval("every")).toBeUndefined()
  })
})

describe("tickLoop", () => {
  test("posts the prompt and marks the loop active", async () => {
    const { ctx, prompts } = makeCtx()
    await seed(ctx)
    expect(await tickLoop(ctx, "abc123")).toBe("completed")
    expect(prompts).toEqual([{ sessionID: "ses_1", text: "check the build" }])
    expect((await loadLoops(ctx))[0].active).toBe(true)
  })

  test("skips while the previous run is active", async () => {
    const { ctx, prompts } = makeCtx()
    await seed(ctx, { active: true })
    expect(await tickLoop(ctx, "abc123")).toBe("skipped")
    expect(prompts).toEqual([])
    expect((await loadLoops(ctx))[0].lastStatus).toBe("skipped")
  })

  test("fails and clears active when the prompt throws", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { prompt: "THROW" })
    expect(await tickLoop(ctx, "abc123")).toBe("failed")
    const loop = (await loadLoops(ctx))[0]
    expect(loop.lastStatus).toBe("failed")
    expect(loop.active).toBe(false)
  })

  test("ignores an unknown id", async () => {
    const { ctx } = makeCtx()
    expect(await tickLoop(ctx, "nope")).toBe("skipped")
  })
})

describe("handleEvent", () => {
  test("clears active on the session's success event", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    const loop = (await loadLoops(ctx))[0]
    expect(loop.active).toBe(false)
    expect(loop.lastStatus).toBe("completed")
  })

  test("ignores other sessions and event types", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_2" } })
    await handleEvent(ctx, { type: "session.step.ended", data: { sessionID: "ses_1" } })
    expect((await loadLoops(ctx))[0].active).toBe(true)
  })
})

describe("armLoop", () => {
  test("fires the callback and stops on demand", () => {
    let ticks = 0
    const callbacks: Array<() => void> = []
    const cleared: any[] = []
    const schedule = ((callback: () => void) => {
      callbacks.push(callback)
      return callbacks.length
    }) as any
    const cancel = ((handle: any) => void cleared.push(handle)) as any

    const loop = { id: "x", sessionID: "s", prompt: "p", intervalMs: 1000, interval: "1s", active: false }
    const handle = armLoop(loop, () => void (ticks += 1), schedule, cancel)
    expect(callbacks).toHaveLength(1)
    callbacks[0]()
    expect(ticks).toBe(1)
    handle.stop()
    expect(cleared).toEqual([1])
  })
})

describe("command", () => {
  const run = (commands: any[], text: string, sessionID = "ses_1") =>
    commands[0].execute({ sessionID, prompt: { text } })

  test("adds a loop and lists it", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "every 30m check the deploy")
    const loops = await loadLoops(ctx)
    expect(loops).toHaveLength(1)
    expect(loops[0].prompt).toBe("check the deploy")
    expect(loops[0].interval).toBe("30m")
    await expect(run(commands, "list")).rejects.toThrow(/check the deploy/)
  })

  test("lists nothing when empty and rejects bad input", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await expect(run(commands, "list")).rejects.toThrow(/No loops/)
    await expect(run(commands, "")).rejects.toThrow(/No loops/)
    await expect(run(commands, "every 5x ping")).rejects.toThrow(/bad interval/)
    await expect(run(commands, "every 1m")).rejects.toThrow(/use \/loop every/)
    await expect(run(commands, "what")).rejects.toThrow(/use \/loop every/)
  })

  test("stops one loop, then all loops", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "every 1m one")
    await run(commands, "every 2h two")
    const loops = await loadLoops(ctx)
    expect(loops).toHaveLength(2)

    await run(commands, `stop ${loops[0].id}`)
    expect(await loadLoops(ctx)).toHaveLength(1)

    await run(commands, "stop all")
    expect(await loadLoops(ctx)).toHaveLength(0)

    await expect(run(commands, "stop nope")).rejects.toThrow(/unknown loop/)
  })
})

describe("setup", () => {
  test("registers the command and returns a cleanup", async () => {
    const { ctx, commands } = makeCtx()
    await seed(ctx, { intervalMs: 3_600_000 })
    const cleanup = await (plugin as any).setup(ctx)
    expect(commands.map((entry) => entry.name)).toEqual(["loop"])
    expect(typeof cleanup).toBe("function")
    cleanup()
  })
})
