import "@testing-library/jest-dom/vitest";
// Initialize the i18n instance (en resources) so `t()` returns English in tests.
import "@/lib/i18n/config";
import { vi } from "vitest";

// jsdom lacks a few browser APIs that shadcn/radix components touch.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const TEST_WIDTH = 1024;
const TEST_HEIGHT = 768;

const testRect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: TEST_HEIGHT,
    right: TEST_WIDTH,
    width: TEST_WIDTH,
    height: TEST_HEIGHT,
    toJSON: () => ({}),
  }) as DOMRect;

Object.defineProperties(HTMLElement.prototype, {
  clientHeight: { configurable: true, get: () => TEST_HEIGHT },
  clientWidth: { configurable: true, get: () => TEST_WIDTH },
  offsetHeight: { configurable: true, get: () => TEST_HEIGHT },
  offsetWidth: { configurable: true, get: () => TEST_WIDTH },
});

HTMLElement.prototype.getBoundingClientRect = testRect;
SVGElement.prototype.getBoundingClientRect = testRect;

class ResizeObserverStub {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: testRect(),
        } as ResizeObserverEntry,
      ],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// Radix UI relies on pointer-capture and scrollIntoView, which jsdom lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
