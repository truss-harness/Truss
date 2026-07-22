export const defaultServerPort = 7805;

export function serverPortCandidates(port: number | undefined): number[] {
  return port === undefined ? [defaultServerPort, 0] : [port];
}
