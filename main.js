// @ts-check
// Pauses the player after a chosen number of minutes, counted in wall-clock time.
const { core, menu, utils, console } = iina;

const PRESETS = [15, 30, 45, 60, 90];

/**
 * The running countdown, or null.
 * @type {{ minutes: number, id: string } | null}
 */
let timer = null;

/**
 * What firing does.
 * @param {number} minutes
 */
function fire(minutes) {
  core.pause();
  changed(`Sleep timer fired after ${minutes} min`);
}

/**
 * Every state change ends here, so anything that reports the state hooks in at one place.
 * @param {string} message
 */
function changed(message) {
  console.log(message);
  renderMenu();
}

function stop() {
  if (timer) clearTimeout(timer.id);
  timer = null;
}

/** @param {number} minutes */
function start(minutes) {
  stop();
  const id = setTimeout(() => {
    stop();
    fire(minutes);
  }, minutes * 60 * 1000);
  timer = { minutes, id };
  changed(`Sleep timer set for ${minutes} min`);
}

function cancel() {
  stop();
  changed("Sleep timer cancelled");
}

function askMinutes() {
  const minutes = Number(utils.prompt("Pause after how many minutes?"));
  if (minutes > 0) start(minutes);
}

// IINA rebuilds the Plugin menu from these items each time it opens.
function renderMenu() {
  menu.removeAllItems();
  const running = timer ? timer.minutes : null;
  const items = [
    ...PRESETS.map((m) =>
      menu.item(`${m} minutes`, () => start(m), { selected: running === m }),
    ),
    menu.item("Custom…", askMinutes, {
      selected: running !== null && !PRESETS.includes(running),
    }),
  ];
  const pauseAfter = menu.item("Pause after");
  items.forEach((item) => pauseAfter.addSubMenuItem(item));
  menu.addItem(pauseAfter);
  // First level, because IINA's submenus auto-enable their items and ignore `enabled`.
  menu.addItem(menu.item("Cancel timer", cancel, { enabled: timer !== null }));
}

renderMenu();
