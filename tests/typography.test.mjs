import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../app/typography.css");

test("Merriweather Regular is self-hosted as WOFF2 with its redistribution licence", () => {
 for (const name of ["latin", "latin-ext"]) {
  const font = readFileSync(new URL(`../public/fonts/merriweather-regular-${name}.woff2`, import.meta.url));
  assert.equal(font.subarray(0,4).toString("ascii"), "wOF2");
  assert.ok(font.length > 1000 && font.length < 100000);
  assert.ok(css.includes(`/fonts/merriweather-regular-${name}.woff2`));
 }
 assert.match(read("../public/fonts/Merriweather-OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);
 assert.doesNotMatch(css, /url\(["']?https?:/);
 assert.equal((css.match(/font-display: swap/g)||[]).length, 2);
 assert.equal((css.match(/font-weight: 400/g)||[]).length, 3);
});

test("reading copy uses requested typography, while compact controls and addresses are preserved", () => {
 assert.match(css, /font-size: 18px;\s*line-height: 1\.65;\s*color: #2D3748;\s*letter-spacing: -0\.01em;/);
 assert.match(css, /\.assessment p,[\s\S]*?\.prose-page p,[\s\S]*?\.evidence-list\s*\{/);
 assert.match(css, /p\.mono, code\s*\{\s*font-family: ui-monospace/);
 assert.match(css, /\.research-loading-caption p\s*\{\s*font: inherit/);
 assert.match(css, /@media\(max-width:600px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
 const layout = read("../app/layout.tsx");
 assert.ok(layout.indexOf('"./typography.css"') > layout.indexOf('"./globals.css"'));
});
