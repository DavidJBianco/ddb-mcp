export const DEFAULT_LIVE_SESSION_VOLUME = "mysterium-session";

const PURPOSE_LABEL = "io.github.davidjbianco.mysterium.purpose";
const MANAGER_LABEL = "io.github.davidjbianco.mysterium.managed-by";

export function validateLiveSessionVolumeName(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error("the live session volume name is invalid");
  }
  return name;
}

export function parseManagedLiveSessionVolume(inspectionText, expectedName) {
  let inspections;
  try {
    inspections = JSON.parse(inspectionText);
  } catch {
    throw new Error("Docker returned an invalid session volume inspection");
  }
  const inspection = Array.isArray(inspections) && inspections.length === 1 ? inspections[0] : undefined;
  if (
    inspection?.Name !== expectedName ||
    inspection?.Labels?.[PURPOSE_LABEL] !== "session" ||
    inspection?.Labels?.[MANAGER_LABEL] !== "mysterium-auth"
  ) {
    throw new Error("the live session volume is not managed by mysterium-auth");
  }
  return inspection;
}

export function dockerLiveArguments({ image, containerName, sessionVolume, outputDirectory }) {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    "org.mysterium.test-suite=live",
    "--interactive",
    "--group-add",
    String(process.getgid?.() ?? 0),
    "--mount",
    `type=volume,src=${sessionVolume},dst=/home/mcp/.config/mysterium,readonly`,
    "--mount",
    `type=bind,src=${outputDirectory},dst=/tmp/mysterium-live-output`,
    image,
  ];
}
