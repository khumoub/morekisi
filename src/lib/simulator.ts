/** The chat simulator is for local development and demos only (docker-compose.yml turns it on). */
export function simulatorEnabled() {
  return process.env.MOREKISI_SIMULATOR === "true";
}
