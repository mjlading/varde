/** Pairing PINs.
 *
 * Varde picks the code and hands it to Moonlight (`pair --pin NNNN`) rather
 * than letting Moonlight invent one. Moonlight is a GUI app whose pairing
 * dialog we cannot suppress, so the only way our screen and its screen can
 * agree is for us to decide the number.
 */

/** A fresh 4-digit pairing PIN, 1000–9999 (Moonlight wants exactly 4 digits). */
export function newPairingPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(1000 + (buf[0] % 9000));
}
