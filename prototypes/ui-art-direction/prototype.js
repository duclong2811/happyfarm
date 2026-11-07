const directions = {
  meadowloom: { label: "A · Cozy Handcrafted Farm", title: "Meadowloom" },
  "sprout-circuit": { label: "B · Modern Stylized Adventure", title: "Sprout Circuit" },
  "hearth-hedge": { label: "C · Rustic Village Storybook", title: "Hearth & Hedge" }
};

const screens = {
  hud: {
    kicker: "HOME ISLAND",
    title: "Your morning",
    html: `
      <div class="hero-note"><strong>A little work, a lot of life.</strong><p>The island is awake. Your carrot rows are ready, and the miller left a note by the old bridge.</p></div>
      <div><p class="section-label">Next on the island <a>View all</a></p><div class="story-row"><span class="story-art">🥕</span><span><strong>Harvest carrots</strong><small>Field row 02 · ready now</small></span><em>+80</em></div></div>
      <div><p class="section-label">Weather</p><div class="story-row"><span class="story-art">☀</span><span><strong>Golden morning</strong><small>Good for crops and spirits</small></span><em>GOOD</em></div></div>`
  },
  work: {
    kicker: "WORK AREAS / 3 ACTIVE",
    title: "Shape the day",
    html: `
      <div class="hero-note"><strong>Give every corner a purpose.</strong><p>Group nearby tiles into a place for your workers.</p></div>
      <div class="content-grid"><article class="work-card"><div class="work-card-head"><span><strong>Sunrise Beds</strong><small> · 12 tiles</small></span><span>⋮</span></div><p>Carrots, wheat, and the little patch beside the pond.</p><div class="work-tags"><span>🌱 2 crops</span><span>▦ 12 cells</span><span>✦ ready</span></div><div class="work-action"><button class="secondary-action">Edit boundary</button><button class="primary-action">Assign worker</button></div></article><article class="work-card"><div class="work-card-head"><span><strong>North Grove</strong><small> · 8 tiles</small></span><span>⋮</span></div><p>Keep the pine line tidy and the wood stacked by the trail.</p><div class="work-tags"><span>🌲 forestry</span><span>▦ 8 cells</span></div><div class="work-action"><button class="secondary-action">Edit boundary</button><button class="primary-action">Assign worker</button></div></article></div>`
  },
  inventory: {
    kicker: "WAREHOUSE / TIER 2",
    title: "Your stores",
    html: `
      <div class="capacity-card"><span class="story-art">▤</span><span><strong>68 / 100 slots</strong><small>Room for a few more good things</small></span><i class="capacity-bar"><i></i></i></div>
      <div class="category-tabs"><button class="is-active">All</button><button>Seeds</button><button>Harvests</button><button>Materials</button></div>
      <div class="content-grid inventory-grid"><article class="item-card is-selected"><span class="item-qty">× 24</span><div class="item-art">🥕</div><strong>Carrot</strong><small>Harvest</small></article><article class="item-card"><span class="item-qty">× 12</span><div class="item-art">🌽</div><strong>Corn seed</strong><small>Seed</small></article><article class="item-card"><span class="item-qty">× 8</span><div class="item-art">🪵</div><strong>Pine wood</strong><small>Material</small></article><article class="item-card"><span class="item-qty">× 4</span><div class="item-art">🐟</div><strong>Carp</strong><small>Fishery</small></article><article class="item-card"><span class="item-qty">× 3</span><div class="item-art">🧺</div><strong>Wild herbs</strong><small>Harvest</small></article><article class="item-card"><span class="item-qty">× 2</span><div class="item-art">🪨</div><strong>Stone</strong><small>Material</small></article></div>`
  },
  shop: {
    kicker: "MARKET DAY / NORTH ROAD",
    title: "The farm market",
    html: `
      <div class="shop-hero"><span><strong>Fresh starts</strong><small>Seeds for a bright week</small></span><span class="price-tag">OPEN</span></div>
      <div class="category-tabs"><button class="is-active">Seeds</button><button>Tools</button><button>Decor</button></div>
      <div class="content-grid"><article class="shop-card"><div class="item-art">🥕</div><span><strong>Carrot seed</strong><small>Quick harvest · 2 min</small></span><button class="buy-button">40 ✦</button></article><article class="shop-card"><div class="item-art">🌻</div><span><strong>Sunflower seed</strong><small>Brightens a field</small></span><button class="buy-button">75 ✦</button></article><article class="shop-card"><div class="item-art">🪣</div><span><strong>Old well bucket</strong><small>Decorative building</small></span><button class="buy-button" disabled>LOCKED</button></article></div>`
  }
};

const body = document.body;
const content = document.querySelector(".screen-content");
const screenTitle = document.querySelector(".screen-title");
const panelKicker = document.querySelector(".panel-kicker");
const currentDirection = document.querySelector(".current-direction");
const currentScreen = document.querySelector(".current-screen");

function renderScreen(screen) {
  const view = screens[screen];
  panelKicker.textContent = view.kicker;
  screenTitle.textContent = view.title;
  content.innerHTML = view.html;
  currentScreen.textContent = screen;
  body.dataset.screen = screen;
  document.querySelectorAll(".toolbar-button").forEach((button) => button.classList.toggle("is-active", button.dataset.screen === screen));
}

function renderDirection(direction) {
  body.dataset.direction = direction;
  currentDirection.textContent = directions[direction].label;
  document.querySelectorAll(".direction-card").forEach((button) => button.classList.toggle("is-active", button.dataset.direction === direction));
}

document.querySelectorAll("[data-direction]").forEach((button) => button.addEventListener("click", () => renderDirection(button.dataset.direction)));
document.querySelectorAll("[data-screen]").forEach((button) => button.addEventListener("click", () => renderScreen(button.dataset.screen)));
const query = new URLSearchParams(window.location.search);
const initialDirection = directions[query.get("direction")] === undefined ? "meadowloom" : query.get("direction");
const initialScreen = screens[query.get("screen")] === undefined ? "hud" : query.get("screen");
renderDirection(initialDirection);
renderScreen(initialScreen);
