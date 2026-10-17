/*
Copyright 2026 Tim

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSecureWebHandler, runHelper } from "../src/secureweb-transport.ts";

function fixture(): { directory: string; profile: string } {
    const directory = mkdtempSync(path.join(tmpdir(), "secureweb-element-"));
    const profile = path.join(directory, "profile.json");
    writeFileSync(profile, JSON.stringify({ upstream_origin: "https://matrix.example" }));
    return { directory, profile };
}

test("Matrix request preserves encoded path, credentials and binary media", async () => {
    const f = fixture();
    try {
        let captured = "";
        const handler = createSecureWebHandler(f.profile, "unused", async (_exe, _profile, input) => {
            captured = input;
            return JSON.stringify({
                status: 200,
                headers: [["content-type", "application/octet-stream"]],
                body: "AAH/",
            });
        });
        const response = await handler(
            new Request("https://matrix.example/_matrix/client/v3/rooms/%21a%3Ab/send", {
                method: "PUT",
                headers: { authorization: "Bearer matrix-only" },
                body: new Uint8Array([0, 1, 255]),
            }),
        );
        const request = JSON.parse(captured);
        assert.equal(request.method, "PUT");
        assert.match(request.url, /%21a%3Ab/);
        assert.equal(request.body, "AAH/");
        assert.deepEqual(request.headers, [["authorization", "Bearer matrix-only"]]);
        assert.equal(response.status, 200);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 255]));
    } finally {
        rmSync(f.directory, { recursive: true });
    }
});

test("cross-origin requests never invoke a transport or plaintext fallback", async () => {
    const f = fixture();
    try {
        let called = false;
        const handler = createSecureWebHandler(f.profile, "unused", async () => {
            called = true;
            return "";
        });
        await assert.rejects(handler(new Request("https://other.example/_matrix/client/versions")), /outside/);
        assert.equal(called, false);
    } finally {
        rmSync(f.directory, { recursive: true });
    }
});

test("malformed replies and helper failure reject the request", async () => {
    const f = fixture();
    try {
        for (const output of [
            "plaintext",
            '{"status":200,"headers":[],"body":"!"}',
            '{"status":0,"headers":[],"body":""}',
        ]) {
            const handler = createSecureWebHandler(f.profile, "unused", async () => output);
            await assert.rejects(handler(new Request("https://matrix.example/")));
        }
        await assert.rejects(
            runHelper(path.join(f.directory, "missing-executable"), f.profile, "{}", new AbortController().signal),
            /could not start/,
        );
    } finally {
        rmSync(f.directory, { recursive: true });
    }
});

test("cancelled requests do not start the helper", async () => {
    const f = fixture();
    try {
        const abort = new AbortController();
        abort.abort();
        let called = false;
        const handler = createSecureWebHandler(f.profile, "unused", async () => {
            called = true;
            return "";
        });
        await assert.rejects(handler(new Request("https://matrix.example/", { signal: abort.signal })), /cancelled/);
        assert.equal(called, false);
    } finally {
        rmSync(f.directory, { recursive: true });
    }
});
