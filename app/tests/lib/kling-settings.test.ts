import { describe, expect, it } from "vitest";
import {
  API_PROTOCOLS,
  generateUrlPreview,
  getDefaultProtocolForProvider,
  getProviderConfigFields,
} from "@/app/(dashboard)/settings/ai-models/components/types";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";
import {
  encryptExtraConfig,
  decryptExtraConfig,
  isEncryptedExtraValue,
} from "@/lib/encryption";
import { isAIProviderProtocol } from "@/types/ai";
describe("Kling settings and capability contract", () => {
  it("normalizes legacy schema to a main apiKey and optional secretKey", () => {
    const fields = getProviderConfigFields(
      {
        configSchema: {
          fields: [
            {
              key: "accessKey",
              type: "password",
              label: "Access Key",
              required: true,
            },
          ],
        },
      },
      "kling"
    );
    expect(fields.map((field) => field.key)).toEqual([
      "apiKey",
      "secretKey",
      "mode",
    ]);
    expect(fields.find((field) => field.key === "secretKey")?.required).toBe(
      false
    );
    expect(getProviderConfigFields({ configSchema: null }, "kling")).toEqual(
      fields
    );
  });
  it("preserves non-Kling fields", () => {
    const schema = {
      fields: [
        { key: "custom", type: "text", label: "Custom", required: true },
      ],
    };
    expect(getProviderConfigFields({ configSchema: schema }, "openai")).toBe(
      schema.fields
    );
  });
  it("registers the protocol and previews the same deduplicated v1 path", () => {
    expect(isAIProviderProtocol("kling")).toBe(true);
    expect(getDefaultProtocolForProvider("kling")).toBe("kling");
    const protocol = API_PROTOCOLS.find((item) => item.id === "kling")!;
    expect(
      generateUrlPreview("https://proxy.example/v1/", protocol, "VIDEO")
    ).toBe("https://proxy.example/v1/videos/image2video");
    expect(protocol.defaultBaseUrl).toBe("https://api-beijing.klingai.com");
  });
  it("advertises the implemented 5/10 second segment range", () => {
    expect(getVideoModelCapability("kling", "kling-v2-6")).toMatchObject({
      requestableDurations: [5, 10],
      nativeClipSeconds: 10,
      supportsFirstLastFrame: false,
    });
  });
  it("encrypts both legacy accessKey and secretKey at rest", () => {
    const plain = {
      accessKey: "legacy-access",
      secretKey: "legacy-secret",
      mode: "std",
    };
    const saved = encryptExtraConfig(plain)!;
    expect(isEncryptedExtraValue(saved.accessKey)).toBe(true);
    expect(isEncryptedExtraValue(saved.secretKey)).toBe(true);
    expect(decryptExtraConfig(saved)).toEqual(plain);
  });
});
