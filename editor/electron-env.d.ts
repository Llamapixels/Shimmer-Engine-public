/// <reference types="vite/client" />

import type { ShimmerEngineApi } from "./shared/ipc";

declare global {
  interface Window {
    api: ShimmerEngineApi;
  }
}
