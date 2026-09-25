import test from "node:test";
import assert from "node:assert/strict";
import { displayLinkLabel } from "../lib/research/link-label.js";

test("cached Twitter label variants display as X", () => {
  for (const label of ["twitter", "Twitter", "TWITTER", "@twitter", "@Twitter", "Twitter profile", "twitter account", "Twitter/X", "x/twitter"]) {
    const link = Object.freeze({ label, url: "https://project.example/social" });
    assert.equal(displayLinkLabel(link), "X", label);
    assert.equal(link.label, label, "The cached label is preserved");
  }
});

test("Twitter metadata types also display as X", () => {
  for (const type of ["twitter", "TWITTER", "@Twitter", "Twitter profile", "Twitter account", "twitter/x", "X/Twitter"]) {
    assert.equal(displayLinkLabel(Object.freeze({ type, url: "https://project.example/social" })), "X", type);
  }
});

test("exact modern and legacy hosts infer X while preserving original URLs", () => {
  for (const host of ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "m.twitter.com"]) {
    for (const protocol of ["https:", "http:"]) {
      const url = `${protocol}//${host}/Example/status/123?ref=project#details`;
      const link = Object.freeze({ label: "Social profile", url, source: "Cached metadata" });
      const before = JSON.stringify(link);
      assert.equal(displayLinkLabel(link), "X", url);
      assert.equal(link.url, url);
      assert.equal(JSON.stringify(link), before, "Display normalization must not change evidence");
    }
  }
  assert.equal(displayLinkLabel({ url: "https://X.COM/Example" }), "X");
});

test("lookalike hosts and URL text do not infer X", () => {
  for (const url of [
    "https://x.com.evil.example/Example",
    "https://twitter.com.evil.example/Example",
    "https://evilx.com/Example",
    "https://not-twitter.com/Example",
    "https://profile.x.com/Example",
    "https://project.example/twitter.com",
    "https://project.example/?redirect=https://x.com/Example",
    "https://x.com@evil.example/Example"
  ]) {
    assert.equal(displayLinkLabel({ label: "Website", url }), "Website", url);
    assert.equal(displayLinkLabel({ url }), "Project link", url);
  }
});

test("only credential-free HTTP and HTTPS URLs infer the platform label", () => {
  for (const url of [
    "ftp://x.com/Example",
    "file://twitter.com/Example",
    "javascript:window.open('https://x.com/Example')",
    "https://person@x.com/Example",
    "https://person:secret@twitter.com/Example",
    "//x.com/Example",
    "x.com/Example",
    "not a URL"
  ]) {
    assert.equal(displayLinkLabel({ label: "Website", url }), "Website", url);
  }
});

test("unrelated labels and project names mentioning Twitter stay verbatim", () => {
  for (const label of ["Telegram", "Discord", "GitHub", "Documentation", "Twitter Token", "The Twitter Project", "Our Twitter strategy", "Xylophone", "X"]) {
    const link = Object.freeze({ label, url: "https://project.example/" });
    assert.equal(displayLinkLabel(link), label);
  }
  assert.equal(displayLinkLabel({ label: "Telegram", url: "https://t.me/example" }), "Telegram");
});

test("missing links and labels use the caller's fallback", () => {
  for (const link of [null, undefined, {}, { label: "", url: "https://project.example/" }]) {
    assert.equal(displayLinkLabel(link), "Project link");
    assert.equal(displayLinkLabel(link, "Inspect link"), "Inspect link");
  }
});
