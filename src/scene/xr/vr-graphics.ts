import {
  CAR_MATERIAL_LABELS, GRAPHICS_OPTIONS, GRAPHICS_PRESETS, GRAPHICS_PRESET_LABELS, SHADOW_QUALITY_LABELS,
  type GraphicsPreset, type GraphicsSettingsValues,
} from "../graphics-settings";

export type VrGraphicsZone =
  | { id: "preset"; preset: GraphicsPreset }
  | { id: "graphicsTab"; tab: number }
  | { id: "graphicsValue"; key: keyof GraphicsSettingsValues; value: string | number | boolean };

const TABS = ["Imagen y luz", "Circuito", "VR y sombras"];
const ROWS: { key: keyof GraphicsSettingsValues; label: string }[][] = [
  [
    { key: "maxPixelRatio", label: "Resolución PC" }, { key: "drawDistance", label: "Distancia de visión" },
    { key: "fog", label: "Bruma de distancia" }, { key: "sky", label: "Cielo detallado" },
    { key: "lighting", label: "Iluminación" }, { key: "exposure", label: "Exposición" },
    { key: "environment", label: "Reflejos del entorno" }, { key: "environmentIntensity", label: "Intensidad de reflejos" },
  ],
  [
    { key: "surfaceDetail", label: "Relieve y rugosidad de superficies" }, { key: "anisotropy", label: "Filtrado de texturas" },
    { key: "carMaterials", label: "Materiales de coches" }, { key: "runoffs", label: "Escapatorias y grava" },
    { key: "trackside", label: "Carteles de frenada" }, { key: "tyreMarks", label: "Goma sobre el asfalto" },
  ],
  [
    { key: "xrScale", label: "Resolución del visor · próxima sesión VR" }, { key: "xrFoveation", label: "Foveación fija · depende del visor" },
    { key: "shadows", label: "Calidad de sombras" }, { key: "shadowDistance", label: "Alcance de sombras" },
    { key: "carShadows", label: "Sombras dinámicas de coches" }, { key: "contactShadows", label: "Sombra de contacto ligera" },
    { key: "detailedCarDistance", label: "Coches detallados hasta" }, { key: "skyStyle", label: "Estilo de cielo" },
  ],
];

export function vrGraphicsLayout(tab: number) {
  const layout: { x: number; y: number; w: number; h: number; zone: VrGraphicsZone | { id: "back" } | { id: "close" } }[] = [
    { x: 36, y: 90, w: 190, h: 48, zone: { id: "back" } },
    { x: 828, y: 90, w: 160, h: 48, zone: { id: "close" } },
  ];
  GRAPHICS_PRESETS.forEach((preset, i) => layout.push({ x: 36 + i * 192, y: 178, w: 180, h: 52, zone: { id: "preset", preset } }));
  TABS.forEach((_, i) => layout.push({ x: 36 + i * 320, y: 252, w: 308, h: 52, zone: { id: "graphicsTab", tab: i } }));
  ROWS[tab].forEach(({ key }, row) => {
    const options = GRAPHICS_OPTIONS[key];
    const width = Math.min(300, 952 / options.length);
    options.forEach((value, i) => layout.push({ x: 36 + i * width, y: 358 + row * 100, w: width - 12, h: 48,
      zone: { id: "graphicsValue", key, value } }));
  });
  return layout;
}

export function drawVrGraphicsLabels(ctx: CanvasRenderingContext2D, tab: number) {
  ctx.fillStyle = "#e8eef5"; ctx.font = "700 42px Segoe UI, sans-serif";
  ctx.fillText("Gráficos", 260, 70);
  ctx.fillStyle = "#9db0c4"; ctx.font = "600 22px Segoe UI, sans-serif";
  ctx.fillText("Perfil gráfico", 36, 165);
  ROWS[tab].forEach(({ label }, row) => ctx.fillText(label, 36, 346 + row * 100));
  ctx.font = "500 22px Segoe UI, sans-serif";
  ctx.fillText(tab === 2 ? "Para cambiar la resolución del visor, sal y entra en VR." : "Los ajustes se guardan y se comparten con la vista PC.", 36, 1220);
}

export function vrGraphicsZoneLabel(zone: VrGraphicsZone): string {
  if (zone.id === "preset") return GRAPHICS_PRESET_LABELS[zone.preset];
  if (zone.id === "graphicsTab") return TABS[zone.tab];
  const { key, value } = zone;
  if (typeof value === "boolean") return value ? "Activado" : "Desactivado";
  if (key === "shadows") return SHADOW_QUALITY_LABELS[value as keyof typeof SHADOW_QUALITY_LABELS];
  if (key === "carMaterials") return CAR_MATERIAL_LABELS[value as keyof typeof CAR_MATERIAL_LABELS];
  if (key === "skyStyle") return value === "clear" ? "Despejado" : "HDR original";
  if (key === "lighting") return ({ day: "Día natural", warm: "Tarde cálida", overcast: "Luz nublada" })[value as "day" | "warm" | "overcast"];
  if (key === "drawDistance" || key === "shadowDistance" || key === "detailedCarDistance") return `${value} m`;
  if (key === "xrScale") return `${Number(value) * 100} %`;
  if (key === "xrFoveation") return Number(value) === 0 ? "Sin foveación" : Number(value) === 1 ? "Alta" : "Media";
  return `${value}${key === "anisotropy" || key === "maxPixelRatio" ? "×" : ""}`;
}
