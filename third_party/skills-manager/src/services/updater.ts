import { invoke } from "@tauri-apps/api/core";
import { UpdateInfo } from "../types";

export async function checkUpdate(): Promise<UpdateInfo> {
  return await invoke("check_update");
}
