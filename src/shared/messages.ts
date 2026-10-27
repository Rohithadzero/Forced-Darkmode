// Typed messages between content scripts, popup and service worker.

export type PageMode = 'css' | 'filter' | 'native' | 'off' | 'excluded' | 'pending';

export type ToWorker =
  | { type: 'css:insert'; css: string }
  | { type: 'css:remove'; css: string }
  | { type: 'css:fetch'; url: string }
  | { type: 'status'; mode: PageMode };

export type ToContent = { type: 'status:get' };

export interface FetchResult {
  ok: boolean;
  text?: string;
}

export interface StatusResult {
  mode: PageMode;
  host: string | null;
  nativeMedia: boolean;
}

export function sendToWorker<T = unknown>(msg: ToWorker): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}
