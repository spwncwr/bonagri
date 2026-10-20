import { ServiceUnavailableException } from "@nestjs/common";
import { v2 as cloudinary } from "cloudinary";
import { MediaService } from "./media.service";

const ENV_KEYS = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

describe("MediaService (CP16a media foundation)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    setEnv(originalEnv);
    jest.restoreAllMocks();
  });

  describe("signUpload", () => {
    it("answers 503 when CLOUDINARY_* is not configured", () => {
      setEnv({});
      const service = new MediaService();

      expect(() => service.signUpload("product")).toThrow(
        ServiceUnavailableException,
      );
    });

    it("issues a signature for a server-generated public_id", () => {
      setEnv({
        CLOUDINARY_CLOUD_NAME: "bonagri-test",
        CLOUDINARY_API_KEY: "key123",
        CLOUDINARY_API_SECRET: "secret123",
      });
      const service = new MediaService();

      const result = service.signUpload("product");

      expect(result.cloudName).toBe("bonagri-test");
      expect(result.apiKey).toBe("key123");
      expect(result.uploadUrl).toBe(
        "https://api.cloudinary.com/v1_1/bonagri-test/image/upload",
      );
      expect(result.publicId).toMatch(/^bonagri\/product\/[0-9a-f-]{36}$/);
      expect(Number.isInteger(result.timestamp)).toBe(true);
      expect(typeof result.signature).toBe("string");
      expect(result.signature.length).toBeGreaterThan(0);
    });

    it("separates supplier_logo uploads into their own folder", () => {
      setEnv({
        CLOUDINARY_CLOUD_NAME: "bonagri-test",
        CLOUDINARY_API_KEY: "key123",
        CLOUDINARY_API_SECRET: "secret123",
      });
      const service = new MediaService();

      expect(service.signUpload("supplier_logo").publicId).toMatch(
        /^bonagri\/supplier_logo\//,
      );
    });
  });

  describe("derivePublicId", () => {
    const service = new MediaService();

    it("parses a plain versioned URL", () => {
      expect(
        service.derivePublicId(
          "https://res.cloudinary.com/demo/image/upload/v1600000000/bonagri/product/abc.jpg",
        ),
      ).toBe("bonagri/product/abc");
    });

    it("skips transformation segments before the version", () => {
      expect(
        service.derivePublicId(
          "https://res.cloudinary.com/demo/image/upload/c_fill,w_200,h_200/q_auto/f_auto/v160/bonagri/supplier_logo/xyz.webp",
        ),
      ).toBe("bonagri/supplier_logo/xyz");
    });

    it("strips the file extension case-insensitively", () => {
      expect(
        service.derivePublicId(
          "https://res.cloudinary.com/demo/image/upload/v1/bonagri/product/photo.PNG",
        ),
      ).toBe("bonagri/product/photo");
    });

    it("ignores query strings", () => {
      expect(
        service.derivePublicId(
          "https://res.cloudinary.com/demo/image/upload/v1/bonagri/product/a.jpg?_a=BAVCAAKtx",
        ),
      ).toBe("bonagri/product/a");
    });

    it("returns null for URLs without a version segment", () => {
      expect(
        service.derivePublicId(
          "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        ),
      ).toBeNull();
    });

    it("returns null for any other host", () => {
      expect(
        service.derivePublicId("https://cdn.examplefarm.co.za/tomatoes.jpg"),
      ).toBeNull();
      expect(service.derivePublicId("http://res.cloudinary.com/x/v1/y.jpg")).toBeNull();
    });

    it("returns null for garbage and empty input", () => {
      expect(service.derivePublicId("not a url")).toBeNull();
      expect(service.derivePublicId("")).toBeNull();
      expect(service.derivePublicId(null)).toBeNull();
      expect(service.derivePublicId(undefined)).toBeNull();
    });
  });

  describe("destroyAsset", () => {
    it("is a no-op without a public_id or without configuration", async () => {
      setEnv({});
      const service = new MediaService();
      const destroySpy = jest.spyOn(cloudinary.uploader, "destroy");

      await expect(service.destroyAsset(null)).resolves.toBeUndefined();
      await expect(service.destroyAsset("")).resolves.toBeUndefined();
      await expect(service.destroyAsset("bonagri/product/x")).resolves.toBeUndefined();
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it("swallows Cloudinary errors (best-effort cleanup)", async () => {
      setEnv({
        CLOUDINARY_CLOUD_NAME: "bonagri-test",
        CLOUDINARY_API_KEY: "key123",
        CLOUDINARY_API_SECRET: "secret123",
      });
      const service = new MediaService();
      jest
        .spyOn(cloudinary.uploader, "destroy")
        .mockRejectedValue(new Error("cloud down"));

      await expect(
        service.destroyAsset("bonagri/product/old"),
      ).resolves.toBeUndefined();
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        "bonagri/product/old",
        { invalidate: true },
      );
    });
  });
});
