import { test, expect, describe } from "bun:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { RelicProvider, useRelic } from "../src/react/index.ts";

function TestAllSecrets() {
  const secrets = useRelic();
  return createElement("pre", null, JSON.stringify(secrets));
}

function TestSingleKey({ keyName }: { keyName: string }) {
  const value = useRelic(keyName);
  return createElement("span", null, String(value));
}

function TestOutsideProvider() {
  const secrets = useRelic();
  return createElement("span", null, JSON.stringify(secrets));
}

describe("react integration", () => {
  const secrets = { API_URL: "https://api.example.com", APP_NAME: "TestApp" };

  test("RelicProvider provides secrets via useRelic()", () => {
    const html = renderToString(
      createElement(RelicProvider, { secrets }, createElement(TestAllSecrets))
    );
    expect(html).toContain("https://api.example.com");
    expect(html).toContain("TestApp");
  });

  test("useRelic(key) returns a single secret value", () => {
    const html = renderToString(
      createElement(
        RelicProvider,
        { secrets },
        createElement(TestSingleKey, { keyName: "API_URL" })
      )
    );
    expect(html).toContain("https://api.example.com");
  });

  test("useRelic() throws when used outside RelicProvider", () => {
    expect(() => {
      renderToString(createElement(TestOutsideProvider));
    }).toThrow("useRelic must be used within a <RelicProvider>");
  });

  test("useRelic(key) throws when key not found", () => {
    expect(() => {
      renderToString(
        createElement(
          RelicProvider,
          { secrets },
          createElement(TestSingleKey, { keyName: "NONEXISTENT" })
        )
      );
    }).toThrow('Secret key "NONEXISTENT" not found in RelicProvider');
  });
});
