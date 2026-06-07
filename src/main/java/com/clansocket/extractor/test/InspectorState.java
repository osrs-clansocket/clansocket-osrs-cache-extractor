package com.clansocket.extractor.test;

/**
 * Shared mutable config between the Swing sidebar (EDT) and the GL render
 * loop (main thread). Each field is volatile so updates from the Swing
 * thread propagate to the render thread without explicit locking.
 *
 * Render loop polls `dirty` each frame; when true, re-builds vertex buffer
 * and resets the flag.
 */
public final class InspectorState {

  public volatile int itemId = 9810;          // farming cape - sticker demo
  public volatile int xan2d = 128;            // ~22.5° tilt
  public volatile int yan2d = 0;              // 0° around Y
  public volatile int zan2d = 0;
  public volatile double zoomMultiplier = 1.0;

  public volatile int priorityZStep = 13;
  public volatile boolean glLequal = true;
  public volatile boolean prioritySort = true;
  public volatile boolean dualColor = true;
  public volatile boolean alphaBlend = true;
  public volatile boolean depthWrite = true;
  public volatile boolean cullFace = false;
  public volatile int cullDirection = 0;     // 0=BACK, 1=FRONT
  public volatile boolean wireframe = false;

  /** -1 = show all priorities, otherwise show only this priority group. */
  public volatile int isolatePriority = -1;

  /** when true, render loop re-builds vertex buffer + reloads model. */
  public volatile boolean dirty = true;

  /** when true, reload the model JSON from disk (item id may have changed too). */
  public volatile boolean reloadModel = true;

  public synchronized void touchDirty() {
    this.dirty = true;
  }

  public synchronized void touchReload() {
    this.reloadModel = true;
    this.dirty = true;
  }
}
