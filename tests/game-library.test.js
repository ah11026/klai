import test from "node:test";
import assert from "node:assert/strict";
import { GameLibrary, MAX_GAME_BYTES, gameLibraryValidation } from "../server/game-library.js";
import { mapRemoteAxis, mapRemoteInput, RemoteInputState } from "../public/js/emulator-controls.js";

const { validateGameFile, validateLicense, validateSource } = gameLibraryValidation;

test("game uploads accept only extensions belonging to their selected system", () => {
  assert.equal(validateGameFile("nes", "homebrew.NES", Buffer.from([1])), ".nes");
  assert.throws(() => validateGameFile("nes", "game.exe", Buffer.from([1])), /لا يناسب النظام/);
  assert.throws(() => validateGameFile("unknown", "game.nes", Buffer.from([1])), /غير مدعوم/);
});

test("game uploads require a secure license reference and enforce the file size cap", () => {
  assert.equal(validateLicense("MIT", "https://example.org/license").license, "MIT");
  assert.throws(() => validateLicense("", "https://example.org/license"), /اذكر ترخيص/);
  assert.throws(() => validateLicense("MIT", "http://example.org/license"), /HTTPS/);
  assert.throws(() => validateGameFile("nes", "game.nes", Buffer.alloc(MAX_GAME_BYTES + 1)), /15 ميغابايت/);
});

test("GitHub source validation rejects traversal and only builds raw GitHub URLs", () => {
  const source = validateSource({ repository: "games/homebrew", branch: "main", filePath: "releases/demo.nes" });
  assert.equal(source.url, "https://raw.githubusercontent.com/games/homebrew/main/releases/demo.nes");
  assert.throws(() => validateSource({ repository: "games/homebrew", branch: "main", filePath: "../secret.nes" }), /غير صالح/);
  assert.throws(() => validateSource({ repository: "https://evil.example/file", branch: "main", filePath: "game.nes" }), /owner\/repository/);
});

test("remote controller inputs map presses and releases even when assigned to player two", () => {
  assert.deepEqual(mapRemoteInput({ player: 2, button: "a", pressed: true }), {
    player: 1, index: 8, value: 1
  });
  assert.deepEqual(mapRemoteInput({ player: 2, button: "a", pressed: false }), {
    player: 1, index: 8, value: 0
  });
  assert.equal(mapRemoteInput({ player: 2, button: "unknown", pressed: true }), null);
  assert.deepEqual(mapRemoteInput({ player: 4, button: "right", pressed: true }), {
    player: 3, index: 7, value: 1
  });
});

test("each player input is independent and held controls are released on disconnect", () => {
  const state = new RemoteInputState();
  assert.deepEqual(state.apply({ player: 1, button: "bad", pressed: true }), []);
  assert.deepEqual(state.apply({ player: 1, button: "a", pressed: true }), [{ player: 0, index: 8, value: 1 }]);
  assert.deepEqual(state.apply({ player: 2, button: "a", pressed: true }), [{ player: 1, index: 8, value: 1 }]);
  assert.deepEqual(state.apply({ player: 1, button: "a", pressed: true }), []);
  assert.deepEqual(state.apply({ player: 1, button: "a", pressed: false }), [{ player: 0, index: 8, value: 0 }]);
  state.apply({ player: 3, button: "up", pressed: true });
  assert.deepEqual(state.releaseAll(), [
    { player: 1, index: 8, value: 0 },
    { player: 2, index: 4, value: 0 }
  ]);
});

test("analog axes map both directions to EmulatorJS indexes and release cleanly", () => {
  assert.deepEqual(mapRemoteAxis({ player: 2, axis: "left-x", value: 0.5 }), [
    { player: 1, index: 16, value: 16384 },
    { player: 1, index: 17, value: 0 }
  ]);
  assert.deepEqual(mapRemoteAxis({ player: 2, axis: "left-y", value: -1 }), [
    { player: 1, index: 18, value: 0 },
    { player: 1, index: 19, value: 32767 }
  ]);
  assert.equal(mapRemoteAxis({ player: 1, axis: "left-x", value: 1.5 }), null);

  const state = new RemoteInputState();
  state.apply({ player: 1, axis: "left-x", value: 0.6 });
  assert.deepEqual(state.releaseAll(), [{ player: 0, index: 16, value: 0 }]);
});

test("all gamepad controls map to libretro indexes for each of four players", () => {
  const expected = {
    b: 0, y: 1, select: 2, start: 3,
    up: 4, down: 5, left: 6, right: 7,
    a: 8, x: 9, l1: 10, r1: 11,
    l2: 12, r2: 13, l3: 14, r3: 15
  };
  for (let player = 1; player <= 4; player++) {
    for (const [button, index] of Object.entries(expected)) {
      assert.deepEqual(mapRemoteInput({ player, button, pressed: true }), {
        player: player - 1, index, value: 1
      });
    }
  }
});

test("saving a licensed game commits the binary and catalog to the configured branch", async () => {
  const calls = [];
  let blobNumber = 0;
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/contents/public/games/catalog.json")) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      return Response.json({ object: { sha: "head-sha" } });
    }
    if (url.endsWith("/git/commits/head-sha")) {
      return Response.json({ tree: { sha: "base-tree" } });
    }
    if (url.endsWith("/git/blobs")) {
      blobNumber += 1;
      return Response.json({ sha: `blob-${blobNumber}` });
    }
    if (url.endsWith("/git/trees")) return Response.json({ sha: "new-tree" });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "new-commit" });
    if (url.endsWith("/git/refs/heads/main")) return Response.json({ ref: "refs/heads/main" });
    throw new Error(`Unexpected GitHub request: ${url}`);
  };
  const library = new GameLibrary({
    token: "test-token",
    repository: "test-owner/test-games",
    branch: "main",
    fetcher
  });

  const game = await library.upload({
    name: "My Demo",
    system: "nes",
    license: "MIT",
    licenseUrl: "https://example.org/license",
    filename: "demo.nes"
  }, Buffer.from([1, 2, 3]));

  assert.equal(game.path.startsWith("public/games/nes/my-demo-"), true);
  assert.equal(calls.filter(call => call.url.endsWith("/git/blobs")).length, 2);
  const treeRequest = calls.find(call => call.url.endsWith("/git/trees"));
  const treePayload = JSON.parse(treeRequest.options.body);
  assert.deepEqual(treePayload.tree.map(entry => entry.path).sort(), [
    game.path,
    "public/games/catalog.json"
  ].sort());
  assert.equal(calls.some(call => call.url.endsWith("/git/refs/heads/main") && call.options.method === "PATCH"), true);
});