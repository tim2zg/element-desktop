/*
Copyright 2026 Tim

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { app, session } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { createSecureWebHandler } from "./secureweb-transport.js";

/** Resolve the explicitly selected profile without modifying it. */
export function secureWebProfilePath(): string | undefined {
    const candidate = path.join(app.getPath("userData"), "secureweb.json");
    return process.env.SECUREWEB_ELEMENT_PROFILE || (existsSync(candidate) ? candidate : undefined);
}

/** Install the service transport before any renderer can issue requests. */
export function installSecureWeb(): void {
    const profile = secureWebProfilePath();
    if (!profile) return;
    const executable = path.join(
        process.resourcesPath,
        "secureweb-desktop-transport" + (process.platform === "win32" ? ".exe" : ""),
    );
    const handler = createSecureWebHandler(profile, executable);
    session.defaultSession.protocol.handle("https", handler);
    session.defaultSession.protocol.handle("http", handler);
    console.info("SecureWeb encrypted service transport enabled");
}
