import assert from "node:assert/strict";
import {
  findBestActiveGroup,
  isMenuItemActive,
} from "../src/utils/annveroNavActiveGroup.js";
import {
  createNavPrefetchController,
  listNavHrefs,
  resolveIdlePrefetchOrder,
  DEV_IDLE_PREFETCH_LIMIT,
  NAV_RESUME_TIMEOUT_MS,
} from "../src/utils/annveroNavPrefetch.js";
import {
  ANNVERO_NAV_GROUPS,
  ANNVERO_NAV_IDLE_PREFETCH_PRIORITY,
} from "../src/config/annveroNavConfig.js";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const groups = [
  {
    title: "Muhasebe Merkezi",
    items: [
      { label: "Muhasebe Ana Sayfa", href: "/muhasebe" },
      { label: "Banka Parser", href: "/muhasebe/banka-ekstresi" },
    ],
  },
  {
    title: "Beyanname Merkezi",
    items: [
      { label: "Mali Yükümlülük Merkezi", href: "/muhasebe/mali-yukumluluk" },
      { label: "Beyanname / Tahakkuk", href: "/muhasebe/beyanname-tahakkuk" },
    ],
  },
];

assert.equal(
  findBestActiveGroup(groups, "/muhasebe/mali-yukumluluk")?.title,
  "Beyanname Merkezi"
);
assert.equal(
  findBestActiveGroup(groups, "/muhasebe/banka-ekstresi")?.title,
  "Muhasebe Merkezi"
);
assert.equal(isMenuItemActive("/muhasebe", "/muhasebe/mali-yukumluluk"), false);

const hrefs = listNavHrefs(ANNVERO_NAV_GROUPS);
assert.ok(hrefs.includes("/muhasebe/banka-kart-operasyon"));
assert.equal(
  hrefs.filter((h) => h === "/muhasebe/firma-yonetimi").length,
  1
);

// Dev idle limiti
const idleDev = resolveIdlePrefetchOrder(
  ANNVERO_NAV_IDLE_PREFETCH_PRIORITY,
  ANNVERO_NAV_GROUPS,
  { maxItems: DEV_IDLE_PREFETCH_LIMIT, excludePath: "/muhasebe/firma-yonetimi" }
);
assert.equal(idleDev.length, DEV_IDLE_PREFETCH_LIMIT);
assert.ok(!idleDev.includes("/muhasebe/firma-yonetimi"));

const idleProd = resolveIdlePrefetchOrder(
  ANNVERO_NAV_IDLE_PREFETCH_PRIORITY,
  ANNVERO_NAV_GROUPS,
  { maxItems: Number.POSITIVE_INFINITY }
);
assert.ok(idleProd.length >= idleDev.length);

// Dedup
{
  const calls = [];
  const ctl = createNavPrefetchController({
    prefetchFn: (href) => calls.push(href),
    staggerMs: 0,
  });
  assert.equal(ctl.enqueue("/muhasebe/banka-ekstresi"), true);
  assert.equal(ctl.enqueue("/muhasebe/banka-ekstresi"), false);
  await wait(15);
  assert.equal(calls.filter((c) => c === "/muhasebe/banka-ekstresi").length, 1);
}

// Navigation: pause + prioritize + diğer href başlamaz
{
  const calls = [];
  const ctl = createNavPrefetchController({
    prefetchFn: (href) => calls.push(`go:${href}`),
    staggerMs: 0,
  });
  ctl.enqueue("/muhasebe/firma-yonetimi");
  ctl.enqueue("/muhasebe/hesap-plani");
  assert.ok(ctl.pending >= 1 || ctl.size >= 0);

  ctl.beginNavigation("/muhasebe/banka-ekstresi", { timeoutMs: 50 });
  assert.equal(ctl.isPaused, true);
  assert.equal(ctl.isNavigationPending, true);
  assert.equal(ctl.pending, 0); // cancelPending
  assert.ok(calls.includes("go:/muhasebe/banka-ekstresi"));

  const before = calls.length;
  assert.equal(ctl.enqueue("/muhasebe/mali-yukumluluk"), false);
  assert.equal(ctl.enqueueMany(["/a", "/b"]), 0);
  assert.equal(calls.length, before);

  // pathname match → resume
  assert.equal(ctl.completeNavigation("/muhasebe/banka-ekstresi"), true);
  assert.equal(ctl.isNavigationPending, false);
  assert.equal(ctl.isPaused, false);

  assert.equal(ctl.enqueue("/muhasebe/mali-yukumluluk"), true);
  await wait(15);
  assert.ok(calls.includes("go:/muhasebe/mali-yukumluluk"));
}

// Timeout fallback resume
{
  const ctl = createNavPrefetchController({
    prefetchFn: () => {},
    staggerMs: 0,
  });
  ctl.beginNavigation("/muhasebe/mali-yukumluluk", { timeoutMs: 40 });
  assert.equal(ctl.isNavigationPending, true);
  await wait(80);
  assert.equal(ctl.isNavigationPending, false);
  assert.equal(ctl.isPaused, false);
  assert.ok(NAV_RESUME_TIMEOUT_MS >= 8000);
}

// Aktif path enqueue edilmez
{
  const calls = [];
  const ctl = createNavPrefetchController({
    prefetchFn: (href) => calls.push(href),
    staggerMs: 0,
  });
  ctl.setActivePath("/muhasebe/banka-ekstresi");
  assert.equal(ctl.enqueue("/muhasebe/banka-ekstresi"), false);
  assert.equal(calls.length, 0);
}

// Yeni menü route'u listNavHrefs'te görünür (genel yapı)
{
  const withExtra = [
    ...ANNVERO_NAV_GROUPS,
    {
      title: "Test Merkezi",
      items: [{ label: "Yeni Sayfa", href: "/muhasebe/yeni-test-route" }],
    },
  ];
  assert.ok(listNavHrefs(withExtra).includes("/muhasebe/yeni-test-route"));
}

assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/muhasebe/police-giderlestirme")
    ?.title,
  "Beyanname Merkezi"
);

console.log("PASS annvero-nav-active-group + prefetch contention");
