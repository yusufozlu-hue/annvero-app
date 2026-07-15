import assert from "node:assert/strict";
import {
  findBestActiveGroup,
  isMenuItemActive,
} from "../src/utils/annveroNavActiveGroup.js";

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

const mali = findBestActiveGroup(groups, "/muhasebe/mali-yukumluluk");
assert.equal(mali?.title, "Beyanname Merkezi");

const banka = findBestActiveGroup(groups, "/muhasebe/banka-ekstresi");
assert.equal(banka?.title, "Muhasebe Merkezi");

const hub = findBestActiveGroup(groups, "/muhasebe");
assert.equal(hub?.title, "Muhasebe Merkezi");

assert.equal(isMenuItemActive("/muhasebe", "/muhasebe/mali-yukumluluk"), false);
assert.equal(isMenuItemActive("/muhasebe/mali-yukumluluk", "/muhasebe/mali-yukumluluk"), true);

console.log("PASS annvero-nav-active-group");
