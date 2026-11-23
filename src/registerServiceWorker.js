import { BASE_URL, appUrl } from "./game/basePath.js";

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(appUrl("service-worker.js"), { scope: BASE_URL }).catch(() => {
      // Registration failure should not block game startup.
    });
  });
}
