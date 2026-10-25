export class AnimationFrames {
  private nextId = 0;
  private readonly pending = new Map<number, FrameRequestCallback>();

  readonly request = (callback: FrameRequestCallback): number => {
    const id = ++this.nextId;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancel = (id: number) => {
    this.pending.delete(id);
  };

  flush(time: number) {
    const pending = [...this.pending.entries()];
    for (const [id, callback] of pending) {
      if (!this.pending.delete(id)) continue;
      callback(time);
    }
  }
}
