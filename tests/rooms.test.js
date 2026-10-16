import test from "node:test";
import assert from "node:assert/strict";
import { RoomStore } from "../server/rooms.js";

test("room assigns available player slots and rejects a fifth player", () => {
  const rooms = new RoomStore();
  const { code } = rooms.create("host");
  assert.equal(rooms.create("host"), null);
  assert.deepEqual(["one", "two", "three", "four"].map(id =>
    rooms.join(code, id, "Player").player
  ), [1, 2, 3, 4]);
  assert.equal(rooms.join(code, "five", "Player").ok, false);

  rooms.leave("two");
  assert.equal(rooms.join(code, "replacement", "Player").player, 2);
});

test("input validates buttons and releases held buttons when a player leaves", () => {
  const rooms = new RoomStore();
  const { code } = rooms.create("host");
  rooms.join(code, "phone", "Player");

  assert.equal(rooms.input("phone", { button: "hack", pressed: true }).ok, false);
  assert.equal(rooms.input("phone", { button: "a", pressed: true }).changed, true);
  assert.equal(rooms.input("phone", { button: "a", pressed: true }).changed, false);
  assert.deepEqual(rooms.leave("phone").released.map(event => [event.button, event.pressed]), [["a", false]]);
});

test("analog inputs validate axes and reset them when a player disconnects", () => {
  const rooms = new RoomStore();
  const { code } = rooms.create("host");
  rooms.join(code, "phone", "Player");

  assert.equal(rooms.input("phone", { axis: "left-x", value: 0.7 }).event.value, 0.7);
  assert.equal(rooms.input("phone", { axis: "left-y", value: 0.06 }).event.value, 0);
  assert.equal(rooms.input("phone", { axis: "left-y", value: 0.06 }).changed, false);
  assert.equal(rooms.input("phone", { axis: "left-x", value: 3 }).ok, false);
  assert.deepEqual(rooms.leave("phone").released.map(({ axis, value }) => [axis, value]), [["left-x", 0]]);
});

test("only the host capability can authenticate room QR requests", () => {
  const rooms = new RoomStore();
  const { code, hostToken } = rooms.create("host");
  assert.equal(rooms.authenticateHost(code, hostToken), true);
  assert.equal(rooms.authenticateHost(code, "wrong-token"), false);
});