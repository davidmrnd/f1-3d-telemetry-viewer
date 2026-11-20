import { decodeReplaySegmentBinary } from "../../data/replay-segment-binary";
import {
  buildTransform, metersToScene, TRACK_KERB_WIDTH_METERS, trackWidthInScene,
} from "../track-geometry";
import { prepareCircuit, snapshotCircuit } from "./circuit-preparation";
import { buildRaceTerrain, snapshotTerrain } from "./track-surfaces";

self.addEventListener("message", ({ data }: MessageEvent<Uint8Array>) => {
  const segment = decodeReplaySegmentBinary(data);
  const transform = buildTransform(segment);
  const edge = trackWidthInScene(transform) / 2 + metersToScene(TRACK_KERB_WIDTH_METERS, transform);
  const { points, closed, sections } = prepareCircuit(segment, transform, edge);
  const terrain = points.length > 1 ? buildRaceTerrain(points, closed, edge, sections) : null;
  const snapshot = snapshotCircuit(points, closed, sections, terrain ? snapshotTerrain(terrain) : undefined);
  const transfer = snapshot.terrain ? Object.values(snapshot.terrain).map(array => array.buffer) : [];
  self.postMessage(snapshot, { transfer });
}, { once: true });
