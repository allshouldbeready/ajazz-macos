import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

let writeSessionApproved = false;

/**
 * Invoke a mutating keyboard command after obtaining one explicit approval for
 * the current connection session. Read-only commands should call `invoke`
 * directly.
 */
export async function invokeDeviceWrite<T>(
  command: string,
  args: InvokeArgs | undefined,
  description: string,
): Promise<T> {
  if (!writeSessionApproved) {
    const approved = await confirm(
      `Allow AK820 Pro Control to modify the connected keyboard?\n\n${description}\n\n` +
        "The app will never access firmware-update or bootloader mode. This approval lasts until you reconnect or restart the app.",
      {
        title: "Confirm keyboard write",
        kind: "warning",
        okLabel: "Allow",
        cancelLabel: "Cancel",
      },
    );
    if (!approved) {
      throw new Error("Device write cancelled.");
    }
    writeSessionApproved = true;
  }
  return invoke<T>(command, args);
}

export function resetDeviceWriteApproval(): void {
  writeSessionApproved = false;
}
