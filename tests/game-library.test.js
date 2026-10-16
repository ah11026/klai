import test from "node:test";
import assert from "node:assert/strict";
import { GameLibrary, MAX_GAME_BYTES, gameLibraryValidation } from "../server/game-library.js";

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