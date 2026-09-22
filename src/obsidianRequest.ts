// The one place API-mode code touches Obsidian's requestUrl (raw `fetch` is
// subject to CORS/mixed-content restrictions in Obsidian's Electron/mobile
// contexts, so requestUrl - which isn't - is the documented way around that).
// Deliberately too thin to unit test meaningfully; covered by manual
// verification against a real notesmd-cli serve instead. Everything else in
// API mode (src/apiClient.ts) is plain, Obsidian-independent code that takes
// this as an injected ApiRequestFn.

import { requestUrl } from 'obsidian';
import { ApiRequestFn } from './apiClient';

export const obsidianRequest: ApiRequestFn = async (url, init) => {
    const res = await requestUrl({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
        throw: false
    });
    let json: unknown = undefined;
    try {
        json = res.json;
    } catch {
        // Non-JSON body, e.g. an HTML error page from a misconfigured proxy.
    }
    return { status: res.status, text: res.text, json };
};
