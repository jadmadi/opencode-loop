// OpenCode V2 loop plugin.
//
// Registers a prompt to run on a fixed cadence. A tick posts the prompt to the
// session that created the loop and marks it active; the session's
// `session.execution.succeeded` event clears the flag, so a tick is skipped
// while the previous run is still going. Loops live while the plugin is loaded.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

interface Loop {
  id: string
  sessionID: string
  prompt: string
  intervalMs: number
  interval: string
  active: boolean
  lastStatus?: "completed" | "skipped" | "failed"
  lastRun?: number
}

function parseInterval(value: string): number | undefined {
  const match = /^(\d+)([smhd])$/.exec(value.trim().toLowerCase())
  if (!match) return undefined
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"]
  const ms = Number(match[1]) * unit
  return ms >= 1000 ? ms : undefined
}

function newID(): string {
  return Math.random().toString(36).slice(2, 8)
}

async function loadLoops(ctx: any): Promise<Loop[]> {
  const stored = await ctx.storage.get("loops")
  return Array.isArray(stored) ? (stored as Loop[]) : []
}

async function saveLoops(ctx: any, loops: Loop[]): Promise<void> {
  await ctx.storage.set("loops", loops)
}

async function addLoop(ctx: any, loop: Loop): Promise<void> {
  const loops = await loadLoops(ctx)
  loops.push(loop)
  await saveLoops(ctx, loops)
}

async function removeLoop(ctx: any, id: string): Promise<boolean> {
  const loops = await loadLoops(ctx)
  const next = loops.filter((loop) => loop.id !== id)
  await saveLoops(ctx, next)
  return next.length !== loops.length
}

async function setStatus(ctx: any, id: string, status: Loop["lastStatus"], active: boolean): Promise<void> {
  const loops = await loadLoops(ctx)
  const loop = loops.find((entry) => entry.id === id)
  if (!loop) return
  loop.lastStatus = status
  loop.active = active
  await saveLoops(ctx, loops)
}

async function tickLoop(ctx: any, id: string): Promise<Loop["lastStatus"]> {
  const loop = (await loadLoops(ctx)).find((entry) => entry.id === id)
  if (!loop) return "skipped"
  if (loop.active) {
    await setStatus(ctx, id, "skipped", true)
    return "skipped"
  }
  await setStatus(ctx, id, "completed", true)
  try {
    await ctx.session.prompt({ sessionID: loop.sessionID, text: loop.prompt })
    return "completed"
  } catch (error) {
    await setStatus(ctx, id, "failed", false)
    return "failed"
  }
}

async function handleEvent(ctx: any, event: any): Promise<void> {
  if (event?.type !== "session.execution.succeeded") return
  const sessionID = event?.data?.sessionID
  if (typeof sessionID !== "string") return
  const loops = await loadLoops(ctx)
  let changed = false
  for (const loop of loops) {
    if (loop.sessionID === sessionID && loop.active) {
      loop.active = false
      loop.lastStatus = "completed"
      changed = true
    }
  }
  if (changed) await saveLoops(ctx, loops)
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
          if (!text || text.toLowerCase() === "list") throw new Error(listText(await loadLoops(ctx)))

          if (text.toLowerCase().startsWith("every ")) {
            const rest = text.slice(6).trim()
            const intervalToken = rest.split(/\s+/)[0] ?? ""
            const promptText = rest.slice(intervalToken.length).trim()
            const intervalMs = parseInterval(intervalToken)
            if (!intervalMs) throw new Error(`bad interval "${intervalToken}"; use 30s, 5m, 2h, or 1d`)
            if (!promptText) throw new Error("use /loop every <interval> <prompt>")
            const loop: Loop = { id: newID(), sessionID, prompt: promptText, intervalMs, interval: intervalToken, active: false }
            await addLoop(ctx, loop)
            startTimer(loop)
            return
          }

          if (text.toLowerCase().startsWith("stop ")) {
            const target = text.slice(5).trim()
            if (target === "all") {
              for (const id of [...timers.keys()]) stopTimer(id)
              await saveLoops(ctx, [])
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
