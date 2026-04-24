(() => {
  const DEFAULT_SELECTOR = "[data-interactive-map][data-map-id]";
  const DEFAULT_CONFIG_URL = "/maps-config.json";
  const DEFAULT_ZOOM = {
    enabled: false,
    min: 1,
    max: 4,
    step: 0.5,
    controls: true,
    pinch: true,
    wheel: false,
    doubleTap: true,
  };
  const loadedConfigs = new Map();
  const instances = new WeakMap();

  const clampPercent = (value) => {
    const number = Number(value);
    if (Number.isNaN(number)) return 0;
    return Math.max(0, Math.min(100, number));
  };

  const toLines = (value) => String(value || "").split(/\r?\n/);

  const readBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
  };

  const readNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const createEl = (tag, className, attrs = {}) => {
    const el = document.createElement(tag);
    if (className) el.className = className;

    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === "text") {
        el.textContent = value;
      } else if (key === "html") {
        el.innerHTML = value;
      } else if (key === "style") {
        Object.assign(el.style, value);
      } else {
        el.setAttribute(key, value === true ? "" : value);
      }
    });

    return el;
  };

  const romanize = (value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || number > 3999) return String(value || "");

    const table = [
      ["M", 1000],
      ["CM", 900],
      ["D", 500],
      ["CD", 400],
      ["C", 100],
      ["XC", 90],
      ["L", 50],
      ["XL", 40],
      ["X", 10],
      ["IX", 9],
      ["V", 5],
      ["IV", 4],
      ["I", 1],
    ];

    let rest = number;
    let result = "";

    table.forEach(([letter, amount]) => {
      while (rest >= amount) {
        result += letter;
        rest -= amount;
      }
    });

    return result;
  };

  const normalizeLocations = (locations = []) =>
    locations.map((location, index) => {
      const id = location.id || `location-${index + 1}`;
      const name = location.name || location.label || id;

      return {
        ...location,
        id,
        name,
        legendText: location.legendText || name,
        tooltipText: location.tooltipText || name,
        markerType: location.markerType || "number",
        tooltipPosition: location.tooltipPosition || "top",
        x: clampPercent(location.x),
        y: clampPercent(location.y),
      };
    });

  const findMapConfig = (rawConfig, mapId) => {
    if (!rawConfig) return null;
    if (Array.isArray(rawConfig.maps)) return rawConfig.maps.find((map) => map.id === mapId) || null;
    if (rawConfig.id === mapId) return rawConfig;
    return null;
  };

  const readInlineConfig = (root) => {
    const scriptId = root.dataset.mapConfigScript;
    if (!scriptId) return null;

    const script = document.getElementById(scriptId);
    if (!script) return null;

    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      console.warn(`InteractiveMaps: JSON in #${scriptId} could not be parsed.`, error);
      return null;
    }
  };

  const loadConfig = async (url) => {
    if (!loadedConfigs.has(url)) {
      loadedConfigs.set(
        url,
        fetch(url, { credentials: "same-origin" }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
      );
    }

    return loadedConfigs.get(url);
  };

  const normalizeZoomConfig = (zoom = {}) => {
    const config = { ...DEFAULT_ZOOM, ...(typeof zoom === "object" ? zoom : {}) };
    const min = Math.max(1, readNumber(config.min, DEFAULT_ZOOM.min));
    const max = Math.max(min, readNumber(config.max, DEFAULT_ZOOM.max));

    return {
      ...config,
      enabled: readBoolean(config.enabled, DEFAULT_ZOOM.enabled),
      min,
      max,
      step: Math.max(0.1, readNumber(config.step, DEFAULT_ZOOM.step)),
      controls: readBoolean(config.controls, DEFAULT_ZOOM.controls),
      pinch: readBoolean(config.pinch, DEFAULT_ZOOM.pinch),
      wheel: readBoolean(config.wheel, DEFAULT_ZOOM.wheel),
      doubleTap: readBoolean(config.doubleTap, DEFAULT_ZOOM.doubleTap),
    };
  };

  const getZoomOverrides = (root, mapConfig) => {
    const zoom = { ...(mapConfig.zoom || {}) };

    if (root.dataset.mapZoom !== undefined) zoom.enabled = readBoolean(root.dataset.mapZoom, zoom.enabled);
    if (root.dataset.mapZoomMax !== undefined) zoom.max = readNumber(root.dataset.mapZoomMax, zoom.max);
    if (root.dataset.mapZoomMin !== undefined) zoom.min = readNumber(root.dataset.mapZoomMin, zoom.min);
    if (root.dataset.mapZoomStep !== undefined) zoom.step = readNumber(root.dataset.mapZoomStep, zoom.step);
    if (root.dataset.mapZoomControls !== undefined) {
      zoom.controls = readBoolean(root.dataset.mapZoomControls, zoom.controls);
    }
    if (root.dataset.mapZoomPinch !== undefined) zoom.pinch = readBoolean(root.dataset.mapZoomPinch, zoom.pinch);
    if (root.dataset.mapZoomWheel !== undefined) zoom.wheel = readBoolean(root.dataset.mapZoomWheel, zoom.wheel);

    return zoom;
  };

  class InteractiveMap {
    constructor(root, config) {
      this.root = root;
      this.config = {
        baseType: "image",
        fit: "contain",
        legendPosition: "left",
        tooltipMode: "onHover",
        highlightLegendFromMarker: true,
        highlightMarkerFromLegend: true,
        closeOnOutsideClick: true,
        allowMultipleActive: false,
        ...config,
      };
      this.zoom = normalizeZoomConfig(this.config.zoom);
      this.locations = normalizeLocations(this.config.locations);
      this.markerEls = new Map();
      this.legendEls = new Map();
      this.activeIds = new Set();
      this.hoveredId = null;
      this.mediaEl = null;
      this.zoomContentEl = null;
      this.zoomState = { scale: this.zoom.min, x: 0, y: 0 };
      this.zoomPointers = new Map();
      this.dragState = null;
      this.pinchState = null;
      this.lastTap = null;
      this.boundDocumentClick = this.handleDocumentClick.bind(this);
      this.boundResize = this.handleResize.bind(this);
    }

    init() {
      this.root.classList.add("im-map");
      this.root.classList.toggle("im-map--has-legend", Boolean(this.config.showLegend));
      this.root.classList.toggle("im-map--legend-right", this.config.legendPosition === "right");
      this.root.classList.toggle("im-map--zoom-enabled", this.zoom.enabled);
      this.root.dataset.imInitialized = "true";
      this.root.innerHTML = "";

      this.render();

      if (this.config.closeOnOutsideClick) {
        document.addEventListener("click", this.boundDocumentClick);
      }

      if (this.zoom.enabled) {
        window.addEventListener("resize", this.boundResize);
      }

      return this;
    }

    destroy() {
      document.removeEventListener("click", this.boundDocumentClick);
      window.removeEventListener("resize", this.boundResize);
      this.root.innerHTML = "";
      this.root.removeAttribute("data-im-initialized");
      this.markerEls.clear();
      this.legendEls.clear();
      this.activeIds.clear();
      this.zoomPointers.clear();
    }

    render() {
      const shell = createEl("div", "im-map__shell");

      if (this.config.title) {
        shell.append(createEl("div", "im-map__title", { text: this.config.title }));
      }

      const layout = createEl("div", "im-map__layout");
      const stage = this.renderStage();
      const legend = this.config.showLegend ? this.renderLegend() : null;

      if (legend && this.config.legendPosition !== "right") layout.append(legend);
      layout.append(stage);
      if (legend && this.config.legendPosition === "right") layout.append(legend);

      shell.append(layout);
      this.root.append(shell);
    }

    renderStage() {
      const stage = createEl("div", "im-map__stage", {
        role: "region",
        "aria-label": this.config.ariaLabel || this.config.title || "Interaktive Karte",
      });

      if (this.config.baseType === "osm") {
        stage.append(this.renderOsmPlaceholder());
        return stage;
      }

      const media = createEl("div", `im-map__media im-map__media--${this.config.fit}`);
      const zoomContent = createEl("div", "im-map__zoom-content");
      const image = createEl("img", "im-map__image", {
        src: this.config.image,
        alt: this.config.imageAlt || "",
        loading: this.config.imageLoading || "lazy",
      });
      const overlay = createEl("div", "im-map__overlay", { "aria-hidden": "false" });

      this.locations.forEach((location, index) => {
        overlay.append(this.renderMarker(location, index));
      });

      zoomContent.append(image, overlay);
      media.append(zoomContent);

      this.mediaEl = media;
      this.zoomContentEl = zoomContent;

      if (this.zoom.enabled) {
        media.classList.add("is-zoomable");
        media.append(this.renderZoomControls());
        this.bindZoomEvents(media);
        this.applyZoom();
      }

      stage.append(media);
      return stage;
    }

    renderZoomControls() {
      const controls = createEl("div", "im-map__zoom-controls", {
        "aria-label": "Kartenzoom",
      });

      if (!this.zoom.controls) {
        controls.hidden = true;
        return controls;
      }

      const zoomIn = createEl("button", "im-map__zoom-button", {
        type: "button",
        text: "+",
        "aria-label": "Karte vergroessern",
      });
      const zoomOut = createEl("button", "im-map__zoom-button", {
        type: "button",
        text: "-",
        "aria-label": "Karte verkleinern",
      });
      const reset = createEl("button", "im-map__zoom-button im-map__zoom-button--reset", {
        type: "button",
        text: "1:1",
        "aria-label": "Kartenzoom zuruecksetzen",
      });

      zoomIn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.zoomBy(this.zoom.step);
      });
      zoomOut.addEventListener("click", (event) => {
        event.stopPropagation();
        this.zoomBy(-this.zoom.step);
      });
      reset.addEventListener("click", (event) => {
        event.stopPropagation();
        this.resetZoom();
      });

      controls.append(zoomIn, zoomOut, reset);
      return controls;
    }

    bindZoomEvents(media) {
      if (this.zoom.wheel) {
        media.addEventListener(
          "wheel",
          (event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -this.zoom.step : this.zoom.step;
            this.setZoom(this.zoomState.scale + delta, { clientX: event.clientX, clientY: event.clientY });
          },
          { passive: false }
        );
      }

      media.addEventListener("pointerdown", (event) => this.handleZoomPointerDown(event));
      media.addEventListener("pointermove", (event) => this.handleZoomPointerMove(event));
      media.addEventListener("pointerup", (event) => this.handleZoomPointerUp(event));
      media.addEventListener("pointercancel", (event) => this.handleZoomPointerUp(event));
      media.addEventListener("lostpointercapture", (event) => this.handleZoomPointerUp(event));
    }

    handleZoomPointerDown(event) {
      if (!this.zoom.enabled || event.target.closest(".im-map__zoom-controls, .im-marker")) return;

      this.zoomPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

      if (this.mediaEl && this.mediaEl.setPointerCapture) {
        this.mediaEl.setPointerCapture(event.pointerId);
      }

      if (event.pointerType === "touch") {
        this.tapCandidate = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          time: Date.now(),
        };
      }

      if (this.zoom.pinch && this.zoomPointers.size === 2) {
        const points = [...this.zoomPointers.values()];
        this.pinchState = {
          distance: this.getDistance(points[0], points[1]),
          scale: this.zoomState.scale,
        };
        event.preventDefault();
        return;
      }

      if (this.zoomState.scale > this.zoom.min) {
        this.dragState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: this.zoomState.x,
          y: this.zoomState.y,
        };
        this.mediaEl.classList.add("is-dragging");
        event.preventDefault();
      }
    }

    handleZoomPointerMove(event) {
      if (!this.zoomPointers.has(event.pointerId)) return;

      this.zoomPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

      if (this.zoom.pinch && this.zoomPointers.size >= 2 && this.pinchState) {
        const points = [...this.zoomPointers.values()];
        const distance = this.getDistance(points[0], points[1]);
        const midpoint = this.getMidpoint(points[0], points[1]);
        const nextScale = this.pinchState.scale * (distance / this.pinchState.distance);
        this.setZoom(nextScale, midpoint);
        event.preventDefault();
        return;
      }

      if (!this.dragState || this.dragState.pointerId !== event.pointerId || this.zoomState.scale <= this.zoom.min) {
        return;
      }

      const dx = event.clientX - this.dragState.startX;
      const dy = event.clientY - this.dragState.startY;
      this.setPan(this.dragState.x + dx, this.dragState.y + dy);
      event.preventDefault();
    }

    handleZoomPointerUp(event) {
      const pointer = this.zoomPointers.get(event.pointerId);
      this.zoomPointers.delete(event.pointerId);

      if (this.dragState && this.dragState.pointerId === event.pointerId) {
        this.dragState = null;
      }

      if (this.zoomPointers.size < 2) {
        this.pinchState = null;
      }

      if (!this.dragState && this.mediaEl) {
        this.mediaEl.classList.remove("is-dragging");
      }

      if (!pointer || event.pointerType !== "touch" || !this.zoom.doubleTap || !this.tapCandidate) return;

      const moved = this.getDistance(this.tapCandidate, { clientX: event.clientX, clientY: event.clientY });
      const elapsed = Date.now() - this.tapCandidate.time;
      const isTap = this.tapCandidate.pointerId === event.pointerId && moved < 12 && elapsed < 360;
      this.tapCandidate = null;

      if (!isTap) return;

      const now = Date.now();
      const isDoubleTap =
        this.lastTap &&
        now - this.lastTap.time < 320 &&
        this.getDistance(this.lastTap, { clientX: event.clientX, clientY: event.clientY }) < 36;

      if (isDoubleTap) {
        const nextScale = this.zoomState.scale <= this.zoom.min ? Math.min(this.zoom.max, 2) : this.zoom.min;
        this.setZoom(nextScale, { clientX: event.clientX, clientY: event.clientY });
        this.lastTap = null;
      } else {
        this.lastTap = { clientX: event.clientX, clientY: event.clientY, time: now };
      }
    }

    getDistance(pointA, pointB) {
      return Math.hypot(pointA.clientX - pointB.clientX, pointA.clientY - pointB.clientY);
    }

    getMidpoint(pointA, pointB) {
      return {
        clientX: (pointA.clientX + pointB.clientX) / 2,
        clientY: (pointA.clientY + pointB.clientY) / 2,
      };
    }

    zoomBy(delta) {
      this.setZoom(this.zoomState.scale + delta, this.getMediaCenter());
    }

    resetZoom() {
      this.zoomState = { scale: this.zoom.min, x: 0, y: 0 };
      this.applyZoom();
    }

    setZoom(scale, origin = this.getMediaCenter()) {
      const nextScale = Math.max(this.zoom.min, Math.min(this.zoom.max, scale));
      const previousScale = this.zoomState.scale;

      if (!this.mediaEl || !this.zoomContentEl || nextScale === previousScale) return;

      const rect = this.mediaEl.getBoundingClientRect();
      const originX = origin.clientX - rect.left;
      const originY = origin.clientY - rect.top;
      const contentX = (originX - this.zoomState.x) / previousScale;
      const contentY = (originY - this.zoomState.y) / previousScale;

      this.zoomState.scale = nextScale;
      this.zoomState.x = originX - contentX * nextScale;
      this.zoomState.y = originY - contentY * nextScale;
      this.clampPan();
      this.applyZoom();
    }

    setPan(x, y) {
      this.zoomState.x = x;
      this.zoomState.y = y;
      this.clampPan();
      this.applyZoom();
    }

    clampPan() {
      if (!this.mediaEl || !this.zoomContentEl) return;

      if (this.zoomState.scale <= this.zoom.min) {
        this.zoomState.x = 0;
        this.zoomState.y = 0;
        return;
      }

      const mediaWidth = this.mediaEl.clientWidth;
      const mediaHeight = this.mediaEl.clientHeight;
      const contentWidth = this.zoomContentEl.offsetWidth;
      const contentHeight = this.zoomContentEl.offsetHeight;
      const minX = Math.min(0, mediaWidth - contentWidth * this.zoomState.scale);
      const minY = Math.min(0, mediaHeight - contentHeight * this.zoomState.scale);

      this.zoomState.x = Math.min(0, Math.max(minX, this.zoomState.x));
      this.zoomState.y = Math.min(0, Math.max(minY, this.zoomState.y));
    }

    applyZoom() {
      if (!this.mediaEl || !this.zoomContentEl) return;

      this.clampPan();
      this.zoomContentEl.style.transform = `translate3d(${this.zoomState.x}px, ${this.zoomState.y}px, 0) scale(${this.zoomState.scale})`;
      this.mediaEl.classList.toggle("is-zoomed", this.zoomState.scale > this.zoom.min);
    }

    getMediaCenter() {
      if (!this.mediaEl) return { clientX: 0, clientY: 0 };

      const rect = this.mediaEl.getBoundingClientRect();
      return {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
    }

    handleResize() {
      this.clampPan();
      this.applyZoom();
    }

    renderOsmPlaceholder() {
      const placeholder = createEl("div", "im-map__osm-placeholder", {
        text: "OpenStreetMap-Basis ist vorbereitet. Hier kann spaeter ein OSM-Adapter initialisiert werden.",
      });

      return placeholder;
    }

    renderMarker(location, index) {
      const markerId = `${this.config.id || "map"}-${location.id}-marker`;
      const tooltipId = `${this.config.id || "map"}-${location.id}-tooltip`;
      const mode = this.getTooltipMode(location);
      const marker = createEl("button", `im-marker im-marker--${location.markerType}`, {
        id: markerId,
        type: "button",
        "data-location-id": location.id,
        "aria-label": location.name,
        "aria-describedby": tooltipId,
        "aria-expanded": mode === "always" ? "true" : "false",
        style: {
          left: `${location.x}%`,
          top: `${location.y}%`,
        },
      });

      marker.append(this.renderMarkerVisual(location, index));
      marker.append(this.renderTooltip(location, tooltipId));

      if (mode === "always" || location.markerType === "pin") {
        marker.classList.add("is-always-visible");
      }

      marker.addEventListener("pointerenter", () => this.setHover(location.id, true));
      marker.addEventListener("pointerleave", () => this.setHover(location.id, false));
      marker.addEventListener("focus", () => this.setHover(location.id, true));
      marker.addEventListener("blur", () => this.setHover(location.id, false));
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleActive(location.id);
      });

      this.markerEls.set(location.id, marker);
      return marker;
    }

    renderMarkerVisual(location, index) {
      const visual = createEl("span", "im-marker__visual", { "aria-hidden": "true" });

      if (location.markerType === "icon") {
        visual.append(this.renderIcon(location.icon, location.name));
        return visual;
      }

      if (location.markerType === "iconGroup") {
        const icons = Array.isArray(location.icons) ? location.icons : [];
        icons.forEach((icon) => visual.append(this.renderIcon(icon, location.name)));
        return visual;
      }

      if (location.markerType === "text") {
        visual.textContent = location.label || location.name;
        return visual;
      }

      if (location.markerType === "pin") {
        visual.append(createEl("span", "im-marker__pin-shape"));
        return visual;
      }

      const rawLabel = location.label || index + 1;
      visual.textContent = location.numberStyle === "roman" ? romanize(rawLabel) : rawLabel;
      return visual;
    }

    renderIcon(icon, fallbackAlt) {
      if (!icon) return createEl("span", "im-marker__missing-icon");

      if (typeof icon === "object" && icon.inlineSvg) {
        return createEl("span", "im-marker__inline-svg", { html: icon.inlineSvg });
      }

      const src = typeof icon === "string" ? icon : icon.src;
      const alt = typeof icon === "object" ? icon.alt || "" : "";

      return createEl("img", "im-marker__icon", {
        src,
        alt,
        title: alt || fallbackAlt,
        loading: "lazy",
      });
    }

    renderTooltip(location, tooltipId) {
      const tooltip = createEl("span", `im-tooltip im-tooltip--${location.tooltipPosition}`, {
        id: tooltipId,
        role: "tooltip",
      });

      toLines(location.tooltipText).forEach((line, index) => {
        if (index > 0) tooltip.append(document.createElement("br"));
        tooltip.append(document.createTextNode(line));
      });

      return tooltip;
    }

    renderLegend() {
      const legend = createEl("aside", "im-map__legend", {
        "aria-label": this.config.legendTitle || "Kartenlegende",
      });

      if (this.config.legendTitle) {
        legend.append(createEl("h3", "im-map__legend-title", { text: this.config.legendTitle }));
      }

      const list = createEl("ul", "im-map__legend-list");

      this.locations.forEach((location, index) => {
        const item = createEl("li", "im-map__legend-item");
        const button = createEl("button", "im-map__legend-button", {
          type: "button",
          "data-location-id": location.id,
          "aria-controls": `${this.config.id || "map"}-${location.id}-marker`,
          "aria-pressed": "false",
        });

        button.append(this.renderLegendVisual(location, index));
        button.append(this.renderLegendText(location));

        button.addEventListener("pointerenter", () => this.setHover(location.id, true));
        button.addEventListener("pointerleave", () => this.setHover(location.id, false));
        button.addEventListener("focus", () => this.setHover(location.id, true));
        button.addEventListener("blur", () => this.setHover(location.id, false));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.toggleActive(location.id);
        });

        this.legendEls.set(location.id, button);
        item.append(button);
        list.append(item);
      });

      legend.append(list);
      return legend;
    }

    renderLegendVisual(location, index) {
      const visual = createEl("span", `im-map__legend-visual im-map__legend-visual--${location.markerType}`, {
        "aria-hidden": "true",
      });

      if (location.markerType === "icon") {
        visual.append(this.renderIcon(location.icon, location.name));
        return visual;
      }

      if (location.markerType === "iconGroup") {
        const icons = Array.isArray(location.icons) ? location.icons : [];
        icons.forEach((icon) => visual.append(this.renderIcon(icon, location.name)));
        return visual;
      }

      if (location.markerType === "pin") {
        visual.append(createEl("span", "im-marker__pin-shape"));
        return visual;
      }

      if (location.markerType === "text") {
        visual.textContent = location.label || "";
        return visual;
      }

      const rawLabel = location.label || index + 1;
      visual.textContent = location.numberStyle === "roman" ? romanize(rawLabel) : rawLabel;
      return visual;
    }

    renderLegendText(location) {
      const text = createEl("span", "im-map__legend-text");

      toLines(location.legendText).forEach((line, index) => {
        const lineEl = createEl("span", "im-map__legend-line", { text: line });
        if (index === 0) lineEl.classList.add("is-primary");
        text.append(lineEl);
      });

      return text;
    }

    getTooltipMode(location) {
      if (location.markerType === "pin") return "always";
      return location.tooltipMode || this.config.tooltipMode || "onHover";
    }

    setHover(locationId, isHovered) {
      const mode = this.getTooltipMode(this.locations.find((location) => location.id === locationId) || {});
      this.hoveredId = isHovered ? locationId : null;

      if (mode === "always") {
        this.syncState();
        return;
      }

      this.syncState();
    }

    toggleActive(locationId) {
      const location = this.locations.find((item) => item.id === locationId);
      if (!location || this.getTooltipMode(location) === "always") return;

      if (this.activeIds.has(locationId)) {
        this.activeIds.delete(locationId);
      } else {
        if (!this.config.allowMultipleActive) this.activeIds.clear();
        this.activeIds.add(locationId);
      }

      this.syncState();
    }

    handleDocumentClick(event) {
      if (this.root.contains(event.target)) return;
      if (!this.activeIds.size) return;

      this.activeIds.clear();
      this.syncState();
    }

    syncState() {
      const visibleIds = new Set(this.activeIds);
      if (this.hoveredId) visibleIds.add(this.hoveredId);

      this.locations.forEach((location) => {
        const marker = this.markerEls.get(location.id);
        const legend = this.legendEls.get(location.id);
        const mode = this.getTooltipMode(location);
        const isVisible = visibleIds.has(location.id) || mode === "always";
        const isActive = this.activeIds.has(location.id);
        const isHovered = this.hoveredId === location.id;

        if (marker) {
          marker.classList.toggle("is-active", isActive);
          marker.classList.toggle("is-hovered", isHovered);
          marker.classList.toggle("is-visible", isVisible);
          marker.setAttribute("aria-expanded", String(isVisible));
        }

        if (legend) {
          legend.classList.toggle("is-active", isActive);
          legend.classList.toggle("is-hovered", isHovered);
          legend.setAttribute("aria-pressed", String(isActive));
        }
      });
    }
  }

  const buildConfigForRoot = async (root) => {
    const mapId = root.dataset.mapId;
    const inlineConfig = readInlineConfig(root) || window.InteractiveMapConfig || window.interactiveMapConfig;
    const rawConfig = inlineConfig || (await loadConfig(root.dataset.mapConfigUrl || DEFAULT_CONFIG_URL));
    const mapConfig = findMapConfig(rawConfig, mapId);

    if (!mapConfig) {
      console.warn(`InteractiveMaps: No configuration found for data-map-id="${mapId}".`);
      return null;
    }

    return {
      ...mapConfig,
      id: mapConfig.id || mapId,
      showLegend:
        root.dataset.showLegend === undefined ? mapConfig.showLegend : root.dataset.showLegend !== "false",
      tooltipMode: root.dataset.tooltipMode || mapConfig.tooltipMode,
      title: root.dataset.mapTitle || mapConfig.title,
      zoom: getZoomOverrides(root, mapConfig),
    };
  };

  const init = async (options = {}) => {
    const selector = options.selector || DEFAULT_SELECTOR;
    const roots = [...document.querySelectorAll(selector)].filter((root) => {
      return options.force || root.dataset.imInitialized !== "true";
    });

    const created = [];

    await Promise.all(
      roots.map(async (root) => {
        try {
          const config = await buildConfigForRoot(root);
          if (!config) return;

          const existing = instances.get(root);
          if (existing) existing.destroy();

          const instance = new InteractiveMap(root, config).init();
          instances.set(root, instance);
          created.push(instance);
        } catch (error) {
          console.warn("InteractiveMaps: Map could not be initialized.", error, root);
        }
      })
    );

    return created;
  };

  const destroy = (root) => {
    const instance = instances.get(root);
    if (!instance) return;
    instance.destroy();
    instances.delete(root);
  };

  window.InteractiveMaps = {
    init,
    destroy,
    version: "1.1.0-dev",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
