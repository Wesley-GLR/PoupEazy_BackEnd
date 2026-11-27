const { createBudgetEmailWorker } = require('./budget-email.service');
const { createFinancialEventEmailWorker } = require('./financial-event-email.service');
function createEmailAlertsWorker(options) {
  const budget = createBudgetEmailWorker(options);
  const events = createFinancialEventEmailWorker(options);
  let running = false; let timer;
  async function runOnce() {
    if (running) return null;
    running = true;
    try { return { budget: await budget.runOnce(), events: await events.runOnce() }; }
    finally { running = false; }
  }
  function start() {
    if (!options.enabled || timer) return;
    void runOnce();
    timer = setInterval(() => { void runOnce(); }, options.intervalMs || 60000);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  return { runOnce, start, stop };
}
module.exports = { createEmailAlertsWorker };
