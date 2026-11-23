function pedalValue(button: GamepadButton | undefined) {
  return button && button.value > 0.04 ? Math.min(1, button.value) : 0;
}

function stickValue(gamepad: Gamepad | undefined) {
  const axis = gamepad?.axes[2] ?? (gamepad?.buttons[2]?.touched ? gamepad.axes[0] ?? 0 : 0);
  const deadzone = 0.14;
  return Math.sign(axis) * Math.min(1, Math.max(0, (Math.abs(axis) - deadzone) / (1 - deadzone)));
}

function readControllers(sources: Iterable<XRInputSource>) {
  let left: Gamepad | undefined;
  let right: Gamepad | undefined;
  for (const { handedness, gamepad } of sources) {
    if (gamepad?.mapping !== "xr-standard") continue;
    if (handedness === "left") left = gamepad;
    if (handedness === "right") right = gamepad;
  }
  const primary = right ?? left;
  const leftSteer = stickValue(left);
  const rightSteer = stickValue(right);
  const pressed = (gamepad: Gamepad | undefined, index: number) => Boolean(gamepad?.buttons[index]?.pressed);
  return {
    throttle: pedalValue(primary?.buttons[0]),
    brake: pedalValue(left && right ? left.buttons[0] : primary?.buttons[1]),
    steer: Math.abs(leftSteer) >= Math.abs(rightSteer) ? leftSteer : rightSteer,
    toggle: pressed(primary, 4) || pressed(primary, 3),
    restart: pressed(primary, 5) || Boolean(right && pressed(left, 3)),
    recenter: Boolean(right && pressed(left, 4)),
  };
}

export class DrivingXrInput {
  private previous: ReturnType<typeof readControllers> | null = null;

  read(sources: Iterable<XRInputSource>) {
    const next = readControllers(sources);
    const previous = this.previous;
    this.previous = next;
    return {
      ...next,
      toggle: previous !== null && next.toggle && !previous.toggle,
      restart: previous !== null && next.restart && !previous.restart,
      recenter: previous !== null && next.recenter && !previous.recenter,
    };
  }

  reset() { this.previous = null; }
}
