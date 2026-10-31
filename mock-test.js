// Runs main.js against a mock of the IINA plugin API it calls: node mock-test.js main.js
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const [, , mainPath] = process.argv;

function makeContext(promptAnswers) {
  const state = { items: [], pauses: 0, logs: [], timers: new Map(), seq: 0 };
  const item = (title, action, options) => {
    const o = options && typeof options === "object" ? options : {};
    return {
      title, action,
      selected: o.selected ?? false, enabled: o.enabled ?? true,
      items: [],
      addSubMenuItem(i) { this.items.push(i); return this; },
    };
  };
  const iina = {
    core: { pause: () => { state.pauses += 1; } },
    menu: {
      item,
      addItem: (i) => state.items.push(i),
      items: () => state.items,
      removeAllItems: () => { state.items = []; },
    },
    utils: { prompt: () => promptAnswers.shift() },
    console: { log: (...a) => state.logs.push(a.join(" ")) },
  };
  // IINA's polyfill returns a string id per timer
  const ctx = vm.createContext({
    iina,
    setTimeout: (cb, ms) => { const id = `t${++state.seq}`; state.timers.set(id, setTimeout(cb, ms)); return id; },
    clearTimeout: (id) => { clearTimeout(state.timers.get(id)); state.timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(mainPath, "utf8"), ctx, { filename: mainPath });
  return state;
}

// IINA builds submenus with AppKit's auto-enabling, so an item there is enabled exactly when its action isn't null
const sub = (s) => s.items[0].items.map((i) => ({ ...i, enabled: i.action !== null }));
const find = (s, t) => sub(s).find((i) => i.title === t);
const cancelItem = (s) => s.items.find((i) => i.title === "Cancel timer");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // load
  let s = makeContext([]);
  assert.deepStrictEqual(s.items.map((i) => i.title), ["Pause after", "Cancel timer"]);
  assert.deepStrictEqual(sub(s).map((i) => i.title),
    ["15 minutes", "30 minutes", "45 minutes", "60 minutes", "90 minutes", "Custom…"]);
  assert.strictEqual(cancelItem(s).enabled, false);
  assert.ok(sub(s).every((i) => !i.selected));

  // preset then cancel
  find(s, "15 minutes").action();
  assert.strictEqual(find(s, "15 minutes").selected, true);
  assert.strictEqual(cancelItem(s).enabled, true);
  cancelItem(s).action();
  assert.ok(sub(s).every((i) => !i.selected));
  assert.strictEqual(cancelItem(s).enabled, false);
  assert.ok(s.logs.includes("Sleep timer cancelled"));
  assert.strictEqual(s.timers.size, 0);

  // custom fires, replacing a running preset
  s = makeContext(["0.001"]);
  find(s, "30 minutes").action();
  find(s, "Custom…").action();
  assert.strictEqual(find(s, "Custom…").selected, true);
  assert.strictEqual(find(s, "30 minutes").selected, false);
  await sleep(150);
  assert.strictEqual(s.pauses, 1);
  assert.ok(s.logs.includes("Sleep timer fired after 0.001 min"), s.logs.join("|"));
  assert.ok(sub(s).every((i) => !i.selected));
  assert.strictEqual(cancelItem(s).enabled, false);
  assert.strictEqual(s.timers.size, 0);

  // bad input sets nothing
  for (const bad of [null, undefined, "", "abc", "0", "-5"]) {
    s = makeContext([bad]);
    find(s, "Custom…").action();
    assert.strictEqual(cancelItem(s).enabled, false, String(bad));
    assert.strictEqual(s.timers.size, 0, String(bad));
  }
  console.log("all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
