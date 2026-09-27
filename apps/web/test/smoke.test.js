import test from "node:test";
import assert from "node:assert/strict";

test("web package smoke test", () => {
  assert.equal(typeof URL.createObjectURL, "function");
});
