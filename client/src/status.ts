import { STATUS_URL } from "./constants";

/**
 * Fail fast when the devnet TEE ephemeral rollup is not operational.
 * `live_status.er`: `true` = operational, `false` = down, absent = N/A.
 */
export async function assertTeeLive(): Promise<void> {
  const j: any = await (await fetch(STATUS_URL)).json();
  const s =
    j.environments?.devnet?.regions?.tee?.servers?.["devnet-tee-as.magicblock.app"]?.live_status;
  if (!s || s.er !== true) {
    throw new Error(`TEE devnet ER not operational: ${JSON.stringify(s)}`);
  }
}
