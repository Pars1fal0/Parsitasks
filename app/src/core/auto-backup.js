export function createAutoBackup(ctx) {
  let generation = 0, running = null, timer = null;
  const clear = ctx.clearInterval || globalThis.clearInterval;
  const repeat = ctx.setInterval || globalThis.setInterval;
  function stop() {
    generation++;
    if (timer !== null) clear(timer);
    timer = null;
    ctx.onNext("");
  }
  function schedule(minutes) {
    stop();
    if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return;
    const interval = Number(minutes) * 60000, currentGeneration = generation, owner = ctx.getOwner();
    const current = () => generation === currentGeneration && owner === ctx.getOwner();
    const next = () => ctx.onNext(new Date(Date.now() + interval).toISOString());
    next();
    timer = repeat(async () => {
      if (!current() || running === currentGeneration) return;
      running = currentGeneration;
      try {
        const local = ctx.backupLocal();
        const file = await ctx.backupFile();
        if (current() && (local?.ok || file?.ok)) ctx.onSaved(new Date().toISOString());
      } catch {
        if (current()) ctx.onError();
      } finally {
        if (running === currentGeneration) running = null;
        if (current()) next();
      }
    }, interval);
  }
  return { schedule, stop };
}
