export const ANSWER_TIMEOUT_MS = 35_000;
export const REFUSAL_GRACE_MS = 1_000;

export function sameParam(a, b) {
  if ((a !== null && typeof a === "object") || (b !== null && typeof b === "object")) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return String(a ?? "") === String(b ?? "");
}

export function createParamRequests({ model, signal, timeoutMs = ANSWER_TIMEOUT_MS, graceMs = REFUSAL_GRACE_MS }) {
  const queue = [];
  let active = null;

  const holds = (job) => {
    const params = model.get("params") || {};
    return Object.entries(job.patch).every(([name, value]) => sameParam(params[name], value));
  };

  const finish = (outcome) => {
    if (!active) return;
    const job = active;
    clearTimeout(job.timer);
    active = null;
    job.done(outcome);
    pump();
  };

  const pump = () => {
    if (active || !queue.length || signal.aborted) return;
    const job = queue.shift();
    active = job;
    job.timer = setTimeout(() => finish({ error: "No answer in time." }), timeoutMs);
    if (holds(job)) {
      job.armed = true;
      const data = model.get("data");
      if (data !== undefined && data !== null && (!job.accept || job.accept(data))) finish({ data });
      return;
    }
    model.set("params", { ...(model.get("params") || {}), ...job.patch });
    model.save_changes();
    job.armed = true;
  };

  const onParams = () => {
    if (!active?.armed || holds(active)) return;
    const waiting = active;
    setTimeout(() => {
      if (active === waiting && !holds(waiting)) finish({ error: waiting.refused });
    }, graceMs);
  };

  const onData = () => {
    if (!active?.armed) return;
    const data = model.get("data");
    if (data === undefined || data === null) return;
    if (active.accept && !active.accept(data)) return;
    finish({ data });
  };

  model.on("change:params", onParams);
  model.on("change:data", onData);
  signal.addEventListener("abort", () => {
    model.off("change:params", onParams);
    model.off("change:data", onData);
    if (active) clearTimeout(active.timer);
  });

  return {
    request({ patch, accept, refused = "The host refused the request." }) {
      return new Promise((done) => {
        queue.push({ patch, accept, refused, done, armed: false });
        pump();
      });
    },
  };
}
