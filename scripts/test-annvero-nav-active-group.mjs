import assert from "node:assert/strict";
import {
  findBestActiveGroup,
  isMenuItemActive,
  partitionNavGroupsByActive,
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

// Kullanıcı istegi: her route için aktif grup dogru bulunmali.
// Alt menüsü olmayan ana menü öğesi (Dashboard) da bulunmali.
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/dashboard")?.title,
  "Dashboard"
);
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/otomasyon/tetikleyiciler")?.title,
  "Otomasyon Merkezi"
);
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/ai-ofis-asistani/siniflandirma")
    ?.title,
  "AI Ofis Asistanı"
);
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/evrak-havuzu/mail")?.title,
  "Evrak Havuzu"
);
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/muhasebe/adat-hesaplama")?.title,
  "Finansal Analiz Merkezi"
);
// Gerçek platform route'u — public /hesaplama-araclari ile karistirilmamali.
assert.equal(
  findBestActiveGroup(ANNVERO_NAV_GROUPS, "/platform/hesaplama-araclari")
    ?.title,
  "Hesaplama Araçları"
);
assert.equal(
  findBestActiveGroup(
    ANNVERO_NAV_GROUPS,
    "/platform/hesaplama-araclari/maas-hesaplama"
  )?.title,
  "Hesaplama Araçları"
);
// Dashboard alt menüsü olmadigi için isMenuItemActive dogrudan eslesir.
assert.equal(isMenuItemActive("/dashboard", "/dashboard"), true);

// --- Sabit (pinlenmiş) aktif grup + kaydırılabilir diğerleri kabul testleri ---
const baseTitles = ANNVERO_NAV_GROUPS.map((g) => g.title);

function assertPartition(pathname, expectedActive) {
  const { activeGroup, otherGroups } = partitionNavGroupsByActive(
    ANNVERO_NAV_GROUPS,
    pathname
  );
  // 1) Aktif grup üstte sabit alana pinlenir.
  assert.equal(activeGroup?.title, expectedActive, `active@${pathname}`);
  // 2) Toplam grup sayısı korunur (pin + digerleri = tümü).
  assert.equal(
    1 + otherGroups.length,
    ANNVERO_NAV_GROUPS.length,
    `count@${pathname}`
  );
  // 3) Aktif grup, kaydirilabilir listede TEKRAR gosterilmez.
  assert.ok(
    !otherGroups.some((g) => g.title === expectedActive),
    `no-dup@${pathname}`
  );
  // 4) Digerleri orijinal goreli sirasini korur.
  const restOriginal = baseTitles.filter((t) => t !== expectedActive);
  assert.deepEqual(
    otherGroups.map((g) => g.title),
    restOriginal,
    `rest-order@${pathname}`
  );
  // 5) Ayni baslik iki kez gorunmez (pin + digerleri birlikte).
  const allTitles = [activeGroup.title, ...otherGroups.map((g) => g.title)];
  assert.equal(new Set(allTitles).size, allTitles.length, `unique@${pathname}`);
}

assertPartition("/platform/hesaplama-araclari", "Hesaplama Araçları");
assertPartition(
  "/platform/hesaplama-araclari/maas-hesaplama",
  "Hesaplama Araçları"
);
assertPartition("/muhasebe/adat-hesaplama", "Finansal Analiz Merkezi");
assertPartition("/otomasyon/tetikleyiciler", "Otomasyon Merkezi");
assertPartition("/dashboard", "Dashboard");

// Kaynak doğrulama: sidebar viewport/idle toplu prefetch yapmamalı
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sidebarSrc = fs.readFileSync(
    path.join(root, "src/components/AnnveroSidebar.jsx"),
    "utf8"
  );
  assert.ok(sidebarSrc.includes("prefetch={false}"));
  assert.ok(!sidebarSrc.includes("prefetch={true}"));
  assert.ok(!sidebarSrc.includes("resolveIdlePrefetchOrder"));
  assert.ok(!sidebarSrc.includes("enqueueMany"));
  assert.ok(sidebarSrc.includes("HOVER_PREFETCH_DELAY_MS"));
}

console.log("PASS annvero-nav-active-group + prefetch contention");
