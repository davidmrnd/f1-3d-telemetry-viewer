import type { RadioBroadcastState, TeamRadioClip } from "../types";
import { paintRadioBroadcast, RADIO_CARD_HEIGHT, RADIO_CARD_WIDTH } from "../scene/radio-broadcast-graphic";
import { mustQuery } from "./dom";

export class RadioBroadcastView {
  private readonly card = mustQuery<HTMLElement>("#radio-broadcast");
  private readonly announcement = mustQuery<HTMLElement>("#radio-announcement");
  private readonly context: CanvasRenderingContext2D | null;
  private clip: TeamRadioClip | null = null;

  constructor() {
    const canvas = mustQuery<HTMLCanvasElement>("#radio-broadcast canvas");
    canvas.width = RADIO_CARD_WIDTH;
    canvas.height = RADIO_CARD_HEIGHT;
    this.context = canvas.getContext("2d");
  }

  update(state: RadioBroadcastState | null) {
    const clip = state?.clip ?? null;
    if (clip !== this.clip) {
      this.clip = clip;
      this.card.hidden = !clip;
      this.announcement.textContent = state ? `Radio de ${state.driver?.fullName ?? `piloto ${state.clip.driverNumber}`}` : "";
    }
    if (state && this.context) paintRadioBroadcast(this.context, state);
  }
}
