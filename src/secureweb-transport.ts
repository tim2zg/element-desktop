/*
Copyright 2026 Tim

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_BODY = 32 * 1024 * 1024;
const MAX_OUTPUT = 48 * 1024 * 1024;
const TIMEOUT_MS = 80_000;

/** Create a handler that routes every permitted service request through the bundled helper. */
export function createSecureWebHandler(
    profilePath: string,
    executable: string,
    runner = runHelper,
): (request: Request) => Promise<Response> {
    if (statSync(profilePath).size > 32768) throw new Error("SecureWeb profile exceeds limit");
    const profile: unknown = JSON.parse(readFileSync(profilePath, "utf8"));
    if (
        !profile ||
        typeof profile !== "object" ||
        !("upstream_origin" in profile) ||
        typeof profile.upstream_origin !== "string"
    )
        throw new Error("Invalid SecureWeb profile");
    const origin = new URL(profile.upstream_origin).origin;

    return async (request: Request): Promise<Response> => {
        if (new URL(request.url).origin !== origin) {
            throw new Error("SecureWeb blocked a request outside the configured service origin");
        }
        if (request.signal.aborted) throw new Error("SecureWeb request cancelled");
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = request.body?.getReader();
        if (reader) {
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    size += chunk.value.byteLength;
                    if (size > MAX_BODY) {
                        await reader.cancel();
                        throw new Error("SecureWeb transfer exceeds 32 MiB");
                    }
                    chunks.push(chunk.value);
                }
            } finally {
                reader.releaseLock();
            }
        }
        const input = JSON.stringify({
            method: request.method,
            url: request.url,
            headers: [...request.headers.entries()],
            body: Buffer.concat(chunks).toString("base64"),
        });
        const output = await runner(executable, profilePath, input, request.signal);
        const decoded: unknown = JSON.parse(output);
        if (
            !decoded ||
            typeof decoded !== "object" ||
            !("status" in decoded) ||
            !("headers" in decoded) ||
            !("body" in decoded) ||
            !Number.isInteger(decoded.status) ||
            typeof decoded.status !== "number" ||
            decoded.status < 200 ||
            decoded.status > 599 ||
            typeof decoded.body !== "string" ||
            !Array.isArray(decoded.headers)
        )
            throw new Error("Invalid SecureWeb response");
        const body = Buffer.from(decoded.body, "base64");
        if (body.length > MAX_BODY || body.toString("base64") !== decoded.body) {
            throw new Error("Invalid SecureWeb response body");
        }
        const headers = new Headers();
        for (const entry of decoded.headers) {
            if (!Array.isArray(entry) || entry.length !== 2 || !entry.every((v: unknown) => typeof v === "string")) {
                throw new Error("Invalid SecureWeb response headers");
            }
            headers.append(entry[0], entry[1]);
        }
        headers.set("access-control-allow-origin", "vector://vector");
        headers.set("access-control-allow-headers", "authorization,content-type");
        headers.set("access-control-allow-methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS");
        return new Response(request.method === "HEAD" || [204, 205, 304].includes(decoded.status) ? null : body, {
            status: decoded.status,
            headers,
        });
    };
}

/** Run one helper with bounded IPC, cancellation and a deadline. */
export function runHelper(
    executable: string,
    profilePath: string,
    input: string,
    signal: AbortSignal,
): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const child = spawn(executable, ["--profile", profilePath], { windowsHide: true, stdio: "pipe" });
        const buffers: Buffer[] = [];
        let length = 0;
        let settled = false;
        const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            if (error) {
                child.kill();
                reject(error);
            } else resolve(Buffer.concat(buffers).toString("utf8"));
        };
        const abort = (): void => finish(new Error("SecureWeb request cancelled"));
        const timer = setTimeout(() => finish(new Error("SecureWeb request timed out")), TIMEOUT_MS);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        child.on("error", () => finish(new Error("SecureWeb transport could not start")));
        child.stdout.on("data", (data: Buffer) => {
            length += data.length;
            if (length > MAX_OUTPUT) finish(new Error("SecureWeb response exceeds limit"));
            else buffers.push(data);
        });
        child.stderr.resume();
        child.stdin.on("error", () => finish(new Error("SecureWeb transport input failed")));
        child.on("close", (code) => finish(code === 0 ? undefined : new Error("SecureWeb encrypted request failed")));
        child.stdin.end(input);
    });
}
