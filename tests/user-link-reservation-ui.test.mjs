import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { getUserLinkReservationView } from "../lib/user-link-reservation-view.ts";

describe("user link reservation management view", () => {
  it("shows creation controls for an editable unlinked person without a reservation", () => {
    assert.deepEqual(getUserLinkReservationView({
      canEdit: true,
      linkedUserUid: null,
    }), { kind: "create" });
  });

  it("shows the pending address to Owner and Editor", () => {
    assert.deepEqual(getUserLinkReservationView({
      canEdit: true,
      linkedUserUid: null,
      reservation: { email: "person@example.com", status: "pending" },
    }), {
      kind: "pending",
      email: "person@example.com",
      conflictPersonName: null,
    });
  });

  it("does not expose a pending address to Viewer", () => {
    assert.deepEqual(getUserLinkReservationView({
      canEdit: false,
      linkedUserUid: null,
      reservation: { email: "private@example.com", status: "pending" },
    }), { kind: "hidden" });
  });

  it("hides reservation controls after a formal link is established", () => {
    assert.deepEqual(getUserLinkReservationView({
      canEdit: true,
      linkedUserUid: "linked-user",
      reservation: { email: "person@example.com", status: "pending" },
    }), { kind: "hidden" });
  });

  it("marks a preserved pending reservation when it conflicts with another person", () => {
    assert.deepEqual(getUserLinkReservationView({
      canEdit: true,
      linkedUserUid: null,
      reservation: {
        email: "person@example.com",
        status: "pending",
        conflictPersonName: "別の関係者",
      },
    }), {
      kind: "pending",
      email: "person@example.com",
      conflictPersonName: "別の関係者",
    });
  });

  it("wires create, change, cancel, and Bearer-authenticated management APIs", async () => {
    const source = await readFile(
      new URL("../app/projects/[projectId]/people/PeopleManagementClient.tsx", import.meta.url),
      "utf8"
    );
    const client = await readFile(
      new URL("../lib/user-link-reservation-client.ts", import.meta.url),
      "utf8"
    );

    assert.match(source, /createProjectUserLinkReservationClient/);
    assert.match(source, /changeProjectUserLinkReservationClient/);
    assert.match(source, /cancelProjectUserLinkReservationClient/);
    assert.match(source, /Googleアカウントで紐づけ予約/);
    assert.match(source, /予約変更/);
    assert.match(source, /予約解除/);
    assert.match(source, /この予約は既存の紐づけと競合しています/);
    assert.match(client, /Authorization: `Bearer \$\{idToken\}`/);
  });
});
