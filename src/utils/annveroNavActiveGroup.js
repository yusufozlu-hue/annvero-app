/**
 * Sol menü aktif grup eşleşmesi — en spesifik (en uzun) href kazanır.
 * /muhasebe hub'ı /muhasebe/mali-yukumluluk gibi alt sayfaları çalmamalı.
 */

export function normalizeMenuPath(href = "") {
  return String(href || "")
    .split("?")[0]
    .replace(/\/$/, "") || "/";
}

export function findBestActiveGroup(groups, pathname) {
  const current = normalizeMenuPath(pathname);
  let bestGroup = null;
  let bestScore = -1;

  for (const group of groups || []) {
    const candidates = [];
    if (group.href) candidates.push(group.href);
    for (const item of group.items || []) {
      if (item?.href) candidates.push(item.href);
    }

    for (const href of candidates) {
      const target = normalizeMenuPath(href);
      let score = -1;
      if (current === target) {
        score = target.length + 1000;
      } else if (target !== "/" && current.startsWith(`${target}/`)) {
        score = target.length;
      }
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
  }

  return bestGroup;
}

/**
 * Aktif ana grubu (sabit/pinlenecek) diğer gruplardan ayırır.
 * - activeGroup: üstte sabit gösterilecek aktif ana grup (yoksa null).
 * - otherGroups: kaydırılabilir alanda gösterilecek gruplar; orijinal
 *   göreli sıralarını korur ve aktif grubu İÇERMEZ (tekrar gösterilmez).
 * Toplam grup sayısı korunur: activeGroup + otherGroups = tüm gruplar.
 */
export function partitionNavGroupsByActive(groups, pathname) {
  const list = Array.isArray(groups) ? groups : [];
  const active = findBestActiveGroup(list, pathname);
  const activeTitle = active?.title || "";
  const otherGroups = activeTitle
    ? list.filter((g) => g.title !== activeTitle)
    : list;
  return { activeGroup: active || null, otherGroups };
}

export function isMenuItemActive(href, pathname) {
  const current = normalizeMenuPath(pathname);
  const target = normalizeMenuPath(href);
  if (current === target) return true;
  const depth = target.split("/").filter(Boolean).length;
  if (depth >= 2 && current.startsWith(`${target}/`)) return true;
  return false;
}
