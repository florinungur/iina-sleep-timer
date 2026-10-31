// Runs main.js against a mock of the IINA plugin API it calls: node mock-test.js main.js
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const [, , mainPath] = process.argv;

function makeContext(promptAnswers) {
  const state = { items: [], pauses: 0, logs: [], timers: new Map(), seq: 0, listeners: {} };
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
    event: { on: (name, cb) => { state.listeners[name] = cb; } },
    menu: {
      item,
      addItem: (i) => state.items.push(i),
      removeAllItems: () => { state.items = []; },
    },
    utils: { prompt: () => promptAnswers.shift() },
    console: { log: (...a) => state.logs.push(a.join(" ")) },
  };
  // Like IINA's polyfill, each timer gets a string id and stays in state.timers until clearTimeout, even after it fires.
  // Nothing is scheduled: tests read each timer's ms and fire it by hand.
  const ctx = vm.createContext({
    iina,
    setTimeout: (cb, ms) => { const id = `t${++state.seq}`; state.timers.set(id, { cb, ms }); return id; },
    clearTimeout: (id) => { state.timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(mainPath, "utf8"), ctx, { filename: mainPath });
  return state;
}

const sub = (s) => s.items[0].items;
const find = (s, t) => sub(s).find((i) => i.title === t);
const cancelItem = (s) => s.items.find((i) => i.title === "Cancel timer");
const delays = (s) => [...s.timers.values()].map((t) => t.ms);
const fireTimers = (s) => [...s.timers.values()].forEach((t) => t.cb());

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

// each preset waits exactly its minutes, replacing the one before
s = makeContext([]);
for (const m of [15, 30, 45, 60, 90]) {
  find(s, `${m} minutes`).action();
  assert.deepStrictEqual(delays(s), [m * 60 * 1000], `${m} minutes`);
}

// custom fires, replacing a running preset
s = makeContext(["0.5"]);
find(s, "30 minutes").action();
find(s, "Custom…").action();
assert.strictEqual(find(s, "Custom…").selected, true);
assert.strictEqual(find(s, "30 minutes").selected, false);
assert.deepStrictEqual(delays(s), [0.5 * 60 * 1000]);
fireTimers(s);
assert.strictEqual(s.pauses, 1);
assert.ok(s.logs.includes("Sleep timer fired after 0.5 min"), s.logs.join("|"));
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

// closing the window cancels a running timer, and only a running one
s = makeContext([]);
s.listeners["iina.window-will-close"]();
assert.ok(!s.logs.includes("Sleep timer cancelled"));
find(s, "45 minutes").action();
s.listeners["iina.window-will-close"]();
assert.ok(sub(s).every((i) => !i.selected));
assert.strictEqual(cancelItem(s).enabled, false);
assert.strictEqual(s.timers.size, 0);
console.log("all checks passed");
