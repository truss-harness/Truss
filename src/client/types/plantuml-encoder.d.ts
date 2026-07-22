declare module "plantuml-encoder" {
  export function decode(encoded: string): string;
  export function encode(source: string): string;

  const plantumlEncoder: {
    decode: typeof decode;
    encode: typeof encode;
  };

  export default plantumlEncoder;
}
