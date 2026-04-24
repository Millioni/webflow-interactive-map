# Webflow Interactive Maps

Vanilla-JavaScript-Loesung fuer mehrere interaktive Karteninstanzen in Webflow. Die Karten werden ueber `data-map-id` initialisiert und laden Orte, Marker, Tooltips und Legenden aus einer JSON-Konfiguration.

## Dateien

- `webflow-interactive-map.js` - modulares Vanilla JavaScript
- `webflow-interactive-map.css` - anpassbares Styling
- `maps-config.example.json` - Beispielkonfiguration fuer mehrere Karten
- `webflow-example.html` - Webflow-kompatible Embed-Beispiele

## Einbindung in Webflow

CSS in den Seiteneinstellungen vor `</head>` einbinden:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/Millioni/webflow-interactive-map@main/webflow-interactive-map.css">
```

Karten-Embed auf der Seite:

```html
<div
  data-interactive-map
  data-map-id="standorte"
  data-map-config-url="https://cdn.jsdelivr.net/gh/Millioni/webflow-interactive-map@main/maps-config.example.json"
></div>
```

JavaScript vor `</body>` einbinden:

```html
<script src="https://cdn.jsdelivr.net/gh/Millioni/webflow-interactive-map@main/webflow-interactive-map.js"></script>
```

Alternativ kann GitHub Pages genutzt werden. Dann sehen die URLs etwa so aus:

```html
<link rel="stylesheet" href="https://millioni.github.io/webflow-interactive-map/webflow-interactive-map.css">
<script src="https://millioni.github.io/webflow-interactive-map/webflow-interactive-map.js"></script>
```

## Neue Karte ergaenzen

In `maps-config.json` einen neuen Eintrag unter `maps` anlegen:

```json
{
  "id": "notfaelle",
  "image": "https://uploads-ssl.webflow.com/your-site/gelaendeplan.jpg",
  "showLegend": true,
  "legendTitle": "Bei Notfaellen",
  "tooltipMode": "onHover",
  "locations": []
}
```

In Webflow muss die Instanz dieselbe ID verwenden:

```html
<div data-interactive-map data-map-id="notfaelle" data-map-config-url=".../maps-config.json"></div>
```

## Neuen Ort ergaenzen

Orte werden in Prozent relativ zum Bild positioniert:

```json
{
  "id": "ort-01",
  "name": "Zutritts-/Buerogebaeude",
  "legendText": "Zutritts-/Buerogebaeude",
  "x": 42.5,
  "y": 61.2,
  "markerType": "number",
  "label": "1",
  "tooltipPosition": "top"
}
```

Wenn `legendText` fehlt, wird automatisch `name` in der Legende verwendet.

## Marker-Typen

- `number` - Zahl oder roemische Zahl als HTML-Text
- `icon` - einzelnes SVG/Icon
- `iconGroup` - mehrere SVGs nebeneinander
- `text` - reines Textlabel
- `pin` - Marker mit dauerhaft sichtbarem Tooltip

## OpenStreetMap

Die Konfiguration unterstuetzt bereits `baseType: "osm"` als Erweiterungspunkt. Der aktuelle Code rendert dafuer einen Platzhalter; spaeter kann dort ein OSM-Adapter, zum Beispiel Leaflet, angeschlossen werden.
