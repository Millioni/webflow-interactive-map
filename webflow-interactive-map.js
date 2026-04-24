(() => {
  const VERSION = "1.1.2";
  const CORE_FILE = "webflow-interactive-map.core.js";
  const ENTRY_FILE = "webflow-interactive-map.js";

  const currentScript = document.currentScript;
  const watchedContent = new WeakSet();

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

  const readTransform = (transform) => {
    const value = String(transform || "");
    const translate = value.match(/translate3d\(\s*([-+]?\d*\.?\d+)px,\s*([-+]?\d*\.?\d+)px/i);
    const scale = value.match(/scale\(\s*([-+]?\d*\.?\d+)\s*\)/i);

    return {
      x: translate ? Number(translate[1]) || 0 : 0,
      y: translate ? Number(translate[2]) || 0 : 0,
      scale: scale ? Number(scale[1]) || 1 : 1,
    };
  };

  const readMarkerPercent = (marker, axis) => {
    const key = axis === "x" ? "imBaseX" : "imBaseY";
    if (marker.dataset[key]) return Number(marker.dataset[key]);

    const value = axis === "x" ? marker.style.left : marker.style.top;
    const percent = Number.parseFloat(value);
    marker.dataset[key] = Number.isFinite(percent) ? String(percent) : "0";
    return Number(marker.dataset[key]);
  };

  const syncMarkerPositions = (media) => {
    const content = media.querySelector(".im-map__zoom-content");
    const overlay = media.querySelector(".im-map__overlay");
    if (!content || !overlay) return;

    if (overlay.parentElement !== media) media.append(overlay);

    const width = content.offsetWidth;
    const height = content.offsetHeight;
    if (!width || !height) return;

    const transform = readTransform(content.style.transform);
    media.style.setProperty("--im-zoom-scale", String(transform.scale));
    media.style.setProperty("--im-inverse-zoom", "1");

    overlay.querySelectorAll(".im-marker").forEach((marker) => {
      const baseX = readMarkerPercent(marker, "x");
      const baseY = readMarkerPercent(marker, "y");
      marker.style.left = `${transform.x + (baseX / 100) * width * transform.scale}px`;
      marker.style.top = `${transform.y + (baseY / 100) * height * transform.scale}px`;
    });
  };

  const watchContent = (media) => {
    const content = media.querySelector(".im-map__zoom-content");
    if (!content || watchedContent.has(content)) return;

    watchedContent.add(content);
    new MutationObserver(() => syncMarkerPositions(media)).observe(content, {
      attributes: true,
      attributeFilter: ["style"],
    });
  };

  const syncAllMaps = () => {
    document.querySelectorAll(".im-map__media").forEach((media) => {
      syncMarkerPositions(media);
      watchContent(media);
    });
  };

  const installSharpMarkerZoom = () => {
    const scheduleSync = () => requestAnimationFrame(syncAllMaps);

    scheduleSync();
    document.addEventListener("DOMContentLoaded", scheduleSync);
    window.addEventListener("load", scheduleSync);
    window.addEventListener("resize", scheduleSync);

    new MutationObserver(scheduleSync).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    if (window.InteractiveMaps && typeof window.InteractiveMaps.init === "function") {
      const originalInit = window.InteractiveMaps.init;
      window.InteractiveMaps.init = async (...args) => {
        const result = await originalInit(...args);
        scheduleSync();
        return result;
      };
      window.InteractiveMaps.version = VERSION;
    }
  };

  loadCore()
    .then(installSharpMarkerZoom)
    .catch((error) => console.warn(error));
})();
