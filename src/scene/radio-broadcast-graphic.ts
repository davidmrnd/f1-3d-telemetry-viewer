import type { RadioBroadcastState } from "../types";

export const RADIO_CARD_WIDTH = 480;
export const RADIO_CARD_HEIGHT = 142;

export function paintRadioBroadcast(ctx: CanvasRenderingContext2D, state: RadioBroadcastState) {
  const { driver, clip, levels, pending } = state;
  const color = driver?.teamColor ?? "#d8e4f8";
  ctx.clearRect(0, 0, RADIO_CARD_WIDTH, RADIO_CARD_HEIGHT);
  const background = ctx.createLinearGradient(0, 0, RADIO_CARD_WIDTH, RADIO_CARD_HEIGHT);
  background.addColorStop(0, "rgba(29, 33, 43, .98)");
  background.addColorStop(1, "rgba(8, 10, 15, .97)");
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(0, 0, RADIO_CARD_WIDTH, RADIO_CARD_HEIGHT, [14, 2, 14, 2]);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillRect(0, 16, 5, 110);
  ctx.font = "italic 800 36px system-ui, sans-serif";
  ctx.fillText(driver?.fullName.toUpperCase() ?? `PILOTO #${clip.driverNumber}`, 24, 61, 432);

  ctx.fillStyle = "#f7f7fa";
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.fillText("RADIO DE EQUIPO", 24, 26);
  ctx.textAlign = "right";
  ctx.fillText(pending ? `+${pending} EN COLA` : `#${clip.driverNumber}`, 456, 26);

  ctx.fillStyle = "#afb8c9";
  ctx.textAlign = "left";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillText(driver?.teamName.toUpperCase() ?? "FÓRMULA 1", 26, 88, 430);

  ctx.fillStyle = color;
  for (let bar = 0; bar < 44; bar++) {
    const bin = 3 + bar * 2;
    const level = Math.max(levels[bin], levels[bin + 1]) / 255;
    const height = 2 + 24 * level * level;
    ctx.globalAlpha = .45 + .55 * level;
    ctx.fillRect(24 + bar * 9.85, 125 - height, 6, height);
  }
  ctx.globalAlpha = 1;
}
