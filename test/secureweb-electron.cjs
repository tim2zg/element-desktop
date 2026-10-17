/*
Copyright 2026 Tim

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/
const { app, BrowserWindow, protocol } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const resultDirectory = path.join(__dirname, "../test_artifacts");
fs.mkdirSync(resultDirectory, { recursive: true });
function report(result) {
    fs.writeFileSync(path.join(resultDirectory, "secureweb-electron-result.json"), JSON.stringify(result, null, 2));
}
report({ status: "starting", electron: process.versions.electron });

protocol.registerSchemesAsPrivileged([
    { scheme: "vector", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "secureweb-electron-"));
const profile = path.join(directory, "profile.json");
fs.writeFileSync(profile, JSON.stringify({ upstream_origin: "https://matrix.example" }));
const deadline = setTimeout(() => {
    report({ status: "failed", error: "timeout" });
    app.exit(1);
}, 30000);

app.whenReady()
    .then(async () => {
        const { createSecureWebHandler } = await import("../lib/secureweb-transport.js");
        const captured = [];
        protocol.handle(
            "https",
            createSecureWebHandler(profile, "unused", async (_exe, _profile, input) => {
                captured.push(JSON.parse(input));
                return JSON.stringify({
                    status: 200,
                    headers: [["content-type", "application/json"]],
                    body: Buffer.from('{"versions":["v1.11"]}').toString("base64"),
                });
            }),
        );
        protocol.handle(
            "vector",
            () =>
                new Response("<html><body>SecureWeb transport fixture</body></html>", {
                    headers: { "content-type": "text/html" },
                }),
        );
        const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        await window.loadURL("vector://vector/");
        const response = await window.webContents
            .executeJavaScript(`fetch("https://matrix.example/_matrix/client/versions", {
        headers: { Authorization: "Bearer matrix-only" }
    }).then(r => r.json())`);
        assert.deepEqual(response, { versions: ["v1.11"] });
        const request = captured.find((r) => r.method === "GET");
        assert.equal(request.url, "https://matrix.example/_matrix/client/versions");
        assert(
            request.headers.some(
                ([key, value]) => key.toLowerCase() === "authorization" && value === "Bearer matrix-only",
            ),
        );
        const blocked = await window.webContents.executeJavaScript(
            `fetch("https://outside.example/").then(() => false, () => true)`,
        );
        assert.equal(blocked, true);
        assert(!captured.some((r) => r.url.startsWith("https://outside.example")));
        clearTimeout(deadline);
        window.destroy();
        fs.rmSync(directory, { recursive: true });
        console.log("Electron renderer transport and cross-origin denial passed");
        report({ status: "passed", checks: ["renderer fetch", "authorization header", "cross-origin denial"] });
        app.exit(0);
    })
    .catch((error) => {
        report({ status: "failed", error: String(error.stack || error) });
        console.error(error);
        app.exit(1);
    });
