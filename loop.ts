// OpenCode V2 loop plugin.
//
// Registers a prompt to run on a fixed cadence. A tick posts the prompt to the
// session that created the loop and marks it active. The session's execution
// end event (succeeded, failed, or interrupted) clears the flag, so a tick is
// skipped while the previous run is still going. One loop per session, because
// the event payload identifies the session, not the run.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

type LoopStatus = "completed" | "skipped" | "failed"

interface Loop {
  id: string
  sessionID: string
  prompt: string
  intervalMs: number
  interval: string
  active: boolean
  lastStatus?: LoopStatus
}

const MAX_INTERVAL_MS = 2_147_483_647

function parseInterval(value: string): number | undefined {
  const match = /^(\d+)([smhd])$/.exec(value.trim().toLowerCase())
  if (!match) return undefined
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"]
  const ms = Number(match[1]) * unit
  return ms >= 1000 && ms <= MAX_INTERVAL_MS ? ms : undefined
}

function newID(): string {
  return Math.random().toString(36).slice(2).padEnd(10, "0").slice(0, 10)
}

async function loadLoops(ctx: any): Promise<Loop[]> {
  const stored = await ctx.storage.get("loops")
  return Array.isArray(stored) ? (stored as Loop[]) : []
}

async function saveLoops(ctx: any, loops: Loop[]): Promise<void> {
  await ctx.storage.set("loops", loops)
}

// Serialize every mutation so concurrent ticks and events cannot lose writes.
let chain: Promise<unknown> = Promise.resolve()

function mutateLoops<T>(ctx: any, change: (loops: Loop[]) => T): Promise<T> {
  const run = chain.then(async () => {
    const loops = await loadLoops(ctx)
    const result = change(loops)
    await saveLoops(ctx, loops)
    return result
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function addLoop(ctx: any, loop: Loop): Promise<boolean> {
  return mutateLoops(ctx, (loops) => {
    if (loops.some((entry) => entry.sessionID === loop.sessionID)) return false
    loops.push(loop)
    return true
  })
}

function removeLoop(ctx: any, id: string): Promise<boolean> {
  return mutateLoops(ctx, (loops) => {
    const index = loops.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    loops.splice(index, 1)
    return true
  })
}

async function tickLoop(ctx: any, id: string): Promise<"started" | "skipped" | "failed"> {
  const loop = await mutateLoops(ctx, (loops) => {
    const found = loops.find((entry) => entry.id === id)
    if (!found) return undefined
    if (found.active) {
      found.lastStatus = "skipped"
      return undefined
    }
    found.active = true
    return { sessionID: found.sessionID, prompt: found.prompt }
  })
  if (!loop) return "skipped"

  try {
    await ctx.session.prompt({ sessionID: loop.sessionID, text: loop.prompt })
    return "started"
  } catch (error) {
    await mutateLoops(ctx, (loops) => {
      const found = loops.find((entry) => entry.id === id)
      if (found) {
        found.active = false
        found.lastStatus = "failed"
      }
    })
    return "failed"
  }
}

function statusFor(type: string): LoopStatus {
  if (type === "session.execution.failed") return "failed"
  if (type === "session.execution.interrupted") return "skipped"
  return "completed"
}

async function handleEvent(ctx: any, event: any): Promise<void> {
  const type = event?.type
  if (type !== "session.execution.succeeded" && type !== "session.execution.failed" && type !== "session.execution.interrupted") {
    return
  }
  const sessionID = event?.data?.sessionID
  if (typeof sessionID !== "string") return
  await mutateLoops(ctx, (loops) => {
    for (const loop of loops) {
      if (loop.sessionID !== sessionID || !loop.active) continue
      loop.active = false
      loop.lastStatus = statusFor(type)
    }
  })
}

function armLoop(loop: Loop, tick: () => void, schedule: any = setInterval, cancel: any = clearInterval) {
  const handle = schedule(() => tick(), loop.intervalMs)
  return { stop: () => cancel(handle) }
}

function listText(loops: Loop[]): string {
  if (loops.length === 0) return "No loops. Use /loop every <interval> <prompt>."
  return loops
    .map((loop) => `${loop.id} every ${loop.interval} [${loop.lastStatus ?? "idle"}] ${loop.prompt}`)
    .join("\n")
}

const plugin = {
  id: "loop",
  async setup(ctx: any) {
    const timers = new Map<string, () => void>()
    const stopTimer = (id: string) => {
      const stop = timers.get(id)
      if (stop) {
        stop()
        timers.delete(id)
      }
    }
    const startTimer = (loop: Loop) => {
      if (timers.has(loop.id)) return
      timers.set(loop.id, armLoop(loop, () => void tickLoop(ctx, loop.id)).stop)
    }

    await ctx.command.transform((editor: any) => {
      editor.add({
        name: "loop",
        description: "Run a prompt on a fixed cadence",
        execute: async ({ sessionID, prompt }: any) => {
          const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""
          const lower = text.toLowerCase()
          if (!text || lower === "list") throw new Error(listText(await loadLoops(ctx)))

          if (lower.startsWith("every ")) {
            const rest = text.slice(6).trim()
            const intervalToken = rest.split(/\s+/)[0] ?? ""
            const promptText = rest.slice(intervalToken.length).trim()
            const intervalMs = parseInterval(intervalToken)
            if (!intervalMs) throw new Error(`bad interval "${intervalToken}"; use 30s, 5m, 2h, or 1d`)
            if (!promptText) throw new Error("use /loop every <interval> <prompt>")
            const loop: Loop = { id: newID(), sessionID, prompt: promptText, intervalMs, interval: intervalToken, active: false }
            const added = await addLoop(ctx, loop)
            if (!added) throw new Error("this session already has a loop; stop it first")
            startTimer(loop)
            return
          }

          if (lower.startsWith("stop ")) {
            const target = text.slice(5).trim()
            if (target.toLowerCase() === "all") {
              for (const id of [...timers.keys()]) stopTimer(id)
              await mutateLoops(ctx, (loops) => {
                loops.length = 0
              })
              return
            }
            const removed = await removeLoop(ctx, target)
            stopTimer(target)
            if (!removed) throw new Error(`unknown loop "${target}"`)
            return
          }

          throw new Error("use /loop every <interval> <prompt>, /loop list, or /loop stop <id|all>")
        },
      })
    })

    // A flag left active by an earlier load can never be cleared by an event
    // that already happened, so reset it before arming.
    await mutateLoops(ctx, (loops) => {
      for (const loop of loops) loop.active = false
    })
    for (const loop of await loadLoops(ctx)) startTimer(loop)

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await handleEvent(ctx, event)
          } catch (error) {
            console.error(`loop: event handling failed: ${error}`)
          }
        }
      } catch {
        // The stream closed or the plugin unloaded.
      }
    })()

    return () => {
      for (const stop of timers.values()) stop()
      timers.clear()
      controller.abort()
    }
  },
}

export { addLoop, armLoop, handleEvent, listText, loadLoops, parseInterval, removeLoop, tickLoop }
export default plugin
