import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyDbError, throwIfFailed } from "./errors";

test("a failed read throws, so the page shows its error screen instead of an empty list", () => {
  assert.throws(
    () => throwIfFailed({ data: [], error: null }, { data: null, error: { message: "canceling statement due to statement timeout" } }),
    /A database read failed: canceling statement due to statement timeout/,
  );
});

test("reads that worked, or were skipped on purpose, pass", () => {
  assert.doesNotThrow(() => throwIfFailed({ data: [{ id: 1 }], error: null }, { data: [] }, { count: 0, error: null }));
  assert.doesNotThrow(() => throwIfFailed());
});

test("database errors still read as plain words", () => {
  assert.equal(friendlyDbError("duplicate key value"), "That's already there.");
});
