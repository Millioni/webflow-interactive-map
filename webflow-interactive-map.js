(() => {
  const VERSION = "1.1.1";
  const CORE_FILE = "webflow-interactive-map.core.js";
  const ENTRY_FILE = "webflow-interactive-map.js";

  const currentScript = document.currentScript;
  const loadedContent = new WeakSet();

  const getCoreSrc = () => {
    if (!currentScript || !currentScript.src) return CORE_FILE;
    return currentScript.src.replace(new RegExp(`${ENTRY_FILE}(\\?.*)?$`), CORE_FILE);
  };

  const loadCore = () => {
    if (window.InteractiveMaps) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = getCoreSrc();
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`InteractiveMaps: ${CORE_FILE} could not be loaded.`));
      document.head.append(script);
    });
  };

  const readScale = (transform) => {
    const match = String(transform || "").match(/scale\(([-+]?\d*\.?\d+)\)/);
    const scale = match ? Number(match[1]) : 1;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };

  const syncMediaScale = (media) => {
    const content = media.querySelector(".im-map__zoom-content");
    if (!content) return;

    const scale = readScale(content.style.transform);
    media.style.setProperty("--im-zoom-scale", String(scale));
    media.style.setProperty("--im-inverse-zoom", String(1 / scale));

    if (loadedContent.has(content)) return;
    loadedContent.add(content);

    new MutationObserver(() => syncMediaScale(media)).observe(content, {
      attributes: true,
      attributeFilter: ["style"],
    });
  };

  const syncAllMedia = () => {
    document.querySelectorAll(".im-map__media").forEach(syncMediaScale);
  };

  const installConstantMarkerScale = () => {
    syncAllMedia();

    new MutationObserver(() => syncAllMedia()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener("DOMContentLoaded", syncAllMedia);
    window.addEventListener("resize", syncAllMedia);
  };

  loadCore()
    .then(() => {
      installConstantMarkerScale();
      if (window.InteractiveMaps) window.InteractiveMaps.version = VERSION;
    })
    .catch((error) => console.warn(error));
})();
