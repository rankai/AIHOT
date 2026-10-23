export type AssetKind = "image" | "audio" | "video";
export interface AssetUploadFormat { format: string; kind: AssetKind; extensions: string[]; mime: string }
export interface AssetUploadOptions {
  formats: AssetUploadFormat[];
  limits: { imageBytes: number; audioBytes: number; videoBytes: number; imagePixels: number };
  imageValidation: { gif: { totalFramePixels: number }; bmp: { compression: "uncompressed"; dibHeaders: number[]; validation: string } };
}
