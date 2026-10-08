export function formatReplayTime(ms: number) {
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatDelta(value: number | null) {
  if (value == null) {
    return "--";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}s`;
}

export function formatInterval(intervalToAhead: number | null, gapToLeader: number | null) {
  if (intervalToAhead != null) {
    return formatDelta(intervalToAhead);
  }
  if (gapToLeader != null) {
    return formatDelta(gapToLeader);
  }
  return "--";
}

const COMPOUND_LETTERS: Record<string, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  INTER: "I",
  WET: "W",
  UNKNOWN: "?",
};

export function compoundLetter(compound: string | null) {
  if (!compound) {
    return "?";
  }
  return COMPOUND_LETTERS[compound.toUpperCase()] ?? compound.slice(0, 1).toUpperCase();
}

export function formatCompoundAge(tyreAge: number | null) {
  if (tyreAge == null) {
    return "";
  }
  return String(tyreAge);
}
