declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: "low" | "medium" | "quartile" | "high" | "L" | "M" | "Q" | "H";
    version?: number;
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toDataURL(
    text: string | Buffer,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;

  export function toDataURL(
    text: string | Buffer,
    options: QRCodeToDataURLOptions,
    callback: (error: Error | null, url: string) => void
  ): void;

  export function toDataURL(
    text: string | Buffer,
    callback: (error: Error | null, url: string) => void
  ): void;
}
