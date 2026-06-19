// Unit tests for app/compat.ts (detectOs/detectBrowser/compatMessage), the port
// of docs/settings.js platform detection. We stub navigator.userAgent /
// userAgentData so the detection is deterministic.

import {afterEach, describe, expect, it, vi} from "vitest";
import {compatMessage, detectBrowser, detectOs} from "../../src/app/compat.js";

function stubNavigator(props: {userAgent?: string; platform?: string; userAgentData?: unknown}): void {
  vi.stubGlobal("navigator", {
    userAgent: props.userAgent ?? "",
    platform: props.platform ?? "",
    userAgentData: props.userAgentData,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectBrowser", () => {
  it("recognizes Chrome on Linux as supported", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    });
    const b = detectBrowser();
    expect(b.name).toBe("Chrome");
    expect(b.supported).toBe(true);
  });

  it("recognizes Edge as supported (Chromium)", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0",
    });
    const b = detectBrowser();
    expect(b.name).toBe("Microsoft Edge");
    expect(b.supported).toBe(true);
  });

  it("marks Safari as unsupported", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
    });
    const b = detectBrowser();
    expect(b.name).toBe("Safari");
    expect(b.supported).toBe(false);
  });

  it("marks Firefox as unsupported", () => {
    stubNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
    });
    const b = detectBrowser();
    expect(b.name).toBe("Firefox");
    expect(b.supported).toBe(false);
  });

  it("uses userAgentData brands when present", () => {
    stubNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120",
      userAgentData: {brands: [{brand: "Google Chrome"}]},
    });
    const b = detectBrowser();
    expect(b.name).toBe("Google Chrome");
    expect(b.supported).toBe(true);
  });
});

describe("detectOs", () => {
  it("detects supported OSes", () => {
    stubNavigator({userAgent: "windows nt 10.0"});
    expect(detectOs()).toMatchObject({name: "Windows", supported: true});
    stubNavigator({userAgent: "linux x86_64"});
    expect(detectOs()).toMatchObject({name: "Linux", supported: true});
    stubNavigator({userAgent: "android 13"});
    expect(detectOs()).toMatchObject({name: "Android", supported: true});
  });

  it("marks iOS as unsupported (iphone UA without the mac-os-x token)", () => {
    // The legacy ordering matches "mac os x" before "iphone"; a real iOS Safari
    // UA carries "like Mac OS X" so it classifies as macOS (faithful to legacy).
    // Use a bare iphone token to exercise the iOS branch itself.
    stubNavigator({userAgent: "mozilla/5.0 (iphone; cpu iphone os 16_0)"});
    expect(detectOs()).toMatchObject({name: "iOS", supported: false});
  });
});

describe("compatMessage", () => {
  it("is empty for a supported Chrome/Linux combo", () => {
    stubNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36",
    });
    expect(compatMessage()).toBe("");
  });

  it("warns on an unsupported browser (Safari/macOS)", () => {
    stubNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.0 Safari/605.1.15",
      platform: "MacIntel",
    });
    const msg = compatMessage();
    expect(msg).toContain("Safari");
    expect(msg).toContain("Google Chrome");
  });

  it("warns on an unsupported OS (iOS branch)", () => {
    stubNavigator({userAgent: "mozilla/5.0 (iphone; cpu iphone os 16_0) safari"});
    expect(compatMessage()).toContain("iOS");
  });
});
