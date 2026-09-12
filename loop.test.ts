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

const seed = async (ctx: any, overrides: Record<string, unknown> = {}) => {
  const loop = {
    id: "abc123",
    sessionID: "ses_1",
    prompt: "check the build",
    intervalMs: 60_000,
    interval: "1m",
    active: false,
    ...overrides,
  }
  await ctx.storage.set("loops", [loop])
  return loop
}

const first = async (ctx: any) => (await loadLoops(ctx))[0]

describe("parseInterval", () => {
  test("parses the supported units", () => {
    expect(parseInterval("30s")).toBe(30_000)
    expect(parseInterval("5m")).toBe(300_000)
    expect(parseInterval("2h")).toBe(7_200_000)
    expect(parseInterval("1d")).toBe(86_400_000)
    expect(parseInterval("5M")).toBe(300_000)
  })

  test("rejects bad input and overflow", () => {
    expect(parseInterval("5x")).toBeUndefined()
    expect(parseInterval("")).toBeUndefined()
    expect(parseInterval("0s")).toBeUndefined()
    expect(parseInterval("30d")).toBeUndefined()
    expect(parseInterval("24d")).toBe(2_073_600_000)
  })
})

describe("tickLoop", () => {
  test("starts the run and marks the loop active", async () => {
    const { ctx, prompts } = makeCtx()
    await seed(ctx)
    expect(await tickLoop(ctx, "abc123")).toBe("started")
    expect(prompts).toEqual([{ sessionID: "ses_1", text: "check the build" }])
    const loop = await first(ctx)
    expect(loop.active).toBe(true)
    expect(loop.lastStatus).toBeUndefined()
  })

  test("skips while the previous run is active", async () => {
    const { ctx, prompts } = makeCtx()
    await seed(ctx, { active: true })
    expect(await tickLoop(ctx, "abc123")).toBe("skipped")
    expect(prompts).toEqual([])
    expect((await first(ctx)).lastStatus).toBe("skipped")
  })

  test("fails and clears active when the prompt throws", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { prompt: "THROW" })
    expect(await tickLoop(ctx, "abc123")).toBe("failed")
    const loop = await first(ctx)
    expect(loop.lastStatus).toBe("failed")
    expect(loop.active).toBe(false)
  })

  test("ignores an unknown id", async () => {
    const { ctx } = makeCtx()
    expect(await tickLoop(ctx, "nope")).toBe("skipped")
  })
})

describe("handleEvent", () => {
  test("clears active on success", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    const loop = await first(ctx)
    expect(loop.active).toBe(false)
    expect(loop.lastStatus).toBe("completed")
  })

  test("clears active on failure and interruption", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.failed", data: { sessionID: "ses_1" } })
    expect((await first(ctx)).lastStatus).toBe("failed")

    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.interrupted", data: { sessionID: "ses_1" } })
    const loop = await first(ctx)
    expect(loop.active).toBe(false)
    expect(loop.lastStatus).toBe("skipped")
  })

  test("ignores other sessions and event types", async () => {
    const { ctx } = makeCtx()
    await seed(ctx, { active: true })
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_2" } })
    await handleEvent(ctx, { type: "session.step.ended", data: { sessionID: "ses_1" } })
    expect((await first(ctx)).active).toBe(true)
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
    await expect(run(commands, "list")).rejects.toThrow(/check the deploy/)
  })

  test("allows only one loop per session", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "every 1m one")
    await expect(run(commands, "every 2m two")).rejects.toThrow(/already has a loop/)
    expect(await loadLoops(ctx)).toHaveLength(1)
  })

  test("lists nothing when empty and rejects bad input", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await expect(run(commands, "list")).rejects.toThrow(/No loops/)
    await expect(run(commands, "")).rejects.toThrow(/No loops/)
    await expect(run(commands, "every 5x ping")).rejects.toThrow(/bad interval/)
    await expect(run(commands, "every 30d ping")).rejects.toThrow(/bad interval/)
    await expect(run(commands, "every 1m")).rejects.toThrow(/use \/loop every/)
    await expect(run(commands, "what")).rejects.toThrow(/use \/loop every/)
  })

  test("stops one loop, then all loops regardless of case", async () => {
    const { ctx, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    await run(commands, "every 1m one")
    const id = (await loadLoops(ctx))[0].id
    await run(commands, `stop ${id}`)
    expect(await loadLoops(ctx)).toHaveLength(0)

    await run(commands, "every 2h two")
    await run(commands, "Stop All")
    expect(await loadLoops(ctx)).toHaveLength(0)

    await expect(run(commands, "stop nope")).rejects.toThrow(/unknown loop/)
  })
})

describe("setup", () => {
  test("re-arms stored loops, resets active, and clears timers on cleanup", async () => {
    const { ctx } = makeCtx()
    const stored = await seed(ctx, { active: true, intervalMs: 3_600_000 })
    const scheduled: any[] = []
    const cleared: any[] = []
    const realSchedule = globalThis.setInterval
    const realCancel = globalThis.clearInterval
    ;(globalThis as any).setInterval = (callback: any) => {
      scheduled.push(callback)
      return scheduled.length
    }
    ;(globalThis as any).clearInterval = (handle: any) => void cleared.push(handle)
    try {
      const cleanup = await (plugin as any).setup(ctx)
      expect(scheduled).toHaveLength(1)
      expect((await first(ctx)).active).toBe(false)
      expect(await tickLoop(ctx, stored.id)).toBe("started")
      cleanup()
      expect(cleared).toEqual([1])
    } finally {
      ;(globalThis as any).setInterval = realSchedule
      ;(globalThis as any).clearInterval = realCancel
    }
  })
})
